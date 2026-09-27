#!/usr/bin/env node
/**
 * Hermes Mobile relay: lets the app reach a Hermes that isn't on the public internet, with no VPN.
 *
 * The connector next to Hermes (server/connector) dials OUT to this relay and registers a host id; the
 * app talks to https://<relay>/h/<host-id>/... and the relay forwards each HTTP request and WebSocket
 * over the connector's socket to the local Hermes dashboard. TLS ends here (run it behind Caddy or any
 * HTTPS proxy); Hermes' own password still guards every request.
 *
 * Env: PORT (8080), RELAY_TOKEN (required: connectors must present it), RELAY_MAX_BODY_MB (25),
 * RELAY_REQUEST_TIMEOUT_S (120), RELAY_LOGIN_PER_MIN (10 sign-in attempts per IP per host),
 * RELAY_TRUST_PROXY (1 behind a reverse proxy that sets X-Forwarded-For, like the bundled Caddy).
 */
import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { WebSocketServer } from "ws";
import { decodeFrame, encodeFrame, HOST_ID } from "./protocol.mjs";

const PORT = Number(process.env.PORT || 8080);
const TOKEN = process.env.RELAY_TOKEN || "";
const MAX_BODY = Number(process.env.RELAY_MAX_BODY_MB || 25) * 1024 * 1024;
const REQUEST_TIMEOUT_MS = Number(process.env.RELAY_REQUEST_TIMEOUT_S || 120) * 1000;
const LOGIN_PER_MIN = Number(process.env.RELAY_LOGIN_PER_MIN || 10);
if (!TOKEN || TOKEN.length < 16) {
  console.error("Set RELAY_TOKEN to a long random secret (at least 16 characters); connectors must present it.");
  process.exit(1);
}

const log = (...args) => console.log(new Date().toISOString(), ...args);
const sameSecret = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

/** host id -> { socket, pending: Map<id, handler>, nextId } */
const hosts = new Map();

// Hop-by-hop and proxy headers never cross the tunnel.
const DROP = new Set(["connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "te", "trailer",
  "host", "content-length", "sec-websocket-key", "sec-websocket-version", "sec-websocket-extensions"]);
const cleanHeaders = (headers) => Object.fromEntries(Object.entries(headers).filter(([k]) => !DROP.has(k.toLowerCase())));

// Slow down password guessing: sign-in attempts per client IP and host.
const attempts = new Map();
function allowLogin(key) {
  const now = Date.now();
  const recent = (attempts.get(key) || []).filter((t) => now - t < 60_000);
  recent.push(now);
  attempts.set(key, recent);
  return recent.length <= LOGIN_PER_MIN;
}
setInterval(() => {
  const now = Date.now();
  for (const [key, times] of attempts) if (!times.some((t) => now - t < 60_000)) attempts.delete(key);
}, 60_000).unref();

function route(url) {
  const match = /^\/h\/([^/?#]+)(\/[^?#]*)?(\?.*)?$/.exec(url || "");
  if (!match || !HOST_ID.test(match[1])) return null;
  return { hostId: match[1], path: (match[2] || "/") + (match[3] || "") };
}

// Behind Caddy (docker-compose) the client address arrives in X-Forwarded-For; exposed directly, that
// header is whatever the client says, so it's only trusted when RELAY_TRUST_PROXY=1.
const TRUST_PROXY = process.env.RELAY_TRUST_PROXY === "1";
function clientIp(req) {
  const forwarded = TRUST_PROXY ? String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() : "";
  return forwarded || req.socket.remoteAddress || "?";
}

function send(host, frame) {
  if (host.socket.readyState === 1) host.socket.send(encodeFrame(frame));
}

// ── HTTP: forward to the host's connector ─────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  if (req.url === "/" || req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: true, service: "hermes-mobile-relay", hosts: hosts.size }));
  }
  const target = route(req.url);
  if (!target) {
    res.writeHead(404, { "content-type": "application/json" });
    return res.end(JSON.stringify({ detail: "Not found" }));
  }
  const host = hosts.get(target.hostId);
  if (!host) {
    res.writeHead(502, { "content-type": "application/json" });
    return res.end(JSON.stringify({ detail: "This Hermes isn't connected to the relay right now." }));
  }
  if (req.method === "POST" && target.path.startsWith("/auth/") && !allowLogin(`${clientIp(req)}|${target.hostId}`)) {
    res.writeHead(429, { "content-type": "application/json", "retry-after": "60" });
    return res.end(JSON.stringify({ detail: "Too many sign-in attempts; wait a minute." }));
  }

  const chunks = [];
  let size = 0;
  req.on("data", (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY) {
      res.writeHead(413).end();
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", () => {
    if (res.headersSent) return;
    const id = host.nextId++;
    const timer = setTimeout(() => {
      host.pending.delete(id);
      if (!res.headersSent) res.writeHead(504, { "content-type": "application/json" });
      res.end(JSON.stringify({ detail: "Hermes didn't answer in time." }));
    }, REQUEST_TIMEOUT_MS);
    host.pending.set(id, (frame) => {
      if (frame.t === "res-head") {
        res.writeHead(frame.status, cleanHeaders(frame.headers || {}));
      } else if (frame.t === "res-body") {
        res.write(Buffer.from(frame.data, "base64"));
      } else if (frame.t === "res-end" || frame.t === "res-error") {
        clearTimeout(timer);
        host.pending.delete(id);
        if (frame.t === "res-error" && !res.headersSent) res.writeHead(502, { "content-type": "application/json" });
        res.end(frame.t === "res-error" && !res.writableEnded ? JSON.stringify({ detail: frame.message || "Hermes is unreachable." }) : undefined);
      }
    });
    res.on("close", () => {
      if (host.pending.has(id)) {
        clearTimeout(timer);
        host.pending.delete(id);
        send(host, { t: "req-cancel", id });
      }
    });
    send(host, {
      t: "req",
      id,
      method: req.method,
      path: target.path,
      headers: { ...cleanHeaders(req.headers), "x-forwarded-for": clientIp(req), "x-forwarded-proto": "https" },
      body: chunks.length ? Buffer.concat(chunks).toString("base64") : null,
    });
  });
});

// ── WebSockets: connectors on /_connect, app sockets on /h/<id>/... ───────────────────────────────
const connectorServer = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 });
const clientServer = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });

server.on("upgrade", (req, socket, head) => {
  if (req.url === "/_connect") {
    return connectorServer.handleUpgrade(req, socket, head, (ws) => acceptConnector(ws, req));
  }
  const target = route(req.url);
  const host = target && hosts.get(target.hostId);
  if (!host) {
    socket.write("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
    return socket.destroy();
  }
  clientServer.handleUpgrade(req, socket, head, (ws) => bridgeClient(ws, host, target.path, req));
});

function acceptConnector(ws, req) {
  let hostId = null;
  const hello = setTimeout(() => ws.close(4401, "hello expected"), 10_000);
  ws.on("message", (raw, isBinary) => {
    const frame = decodeFrame(raw, isBinary);
    if (!frame) return;
    if (!hostId) {
      clearTimeout(hello);
      if (frame.t !== "hello" || !sameSecret(frame.token, TOKEN) || !HOST_ID.test(String(frame.host || ""))) {
        log("rejected connector from", clientIp(req));
        return ws.close(4401, "bad token or host id");
      }
      hostId = frame.host;
      const previous = hosts.get(hostId);
      if (previous) previous.socket.close(4409, "replaced by a newer connection");
      hosts.set(hostId, { socket: ws, pending: new Map(), sockets: new Map(), nextId: 1 });
      ws.send(encodeFrame({ t: "welcome", host: hostId }));
      log(`host ${hostId} connected from ${clientIp(req)}`);
      return;
    }
    const host = hosts.get(hostId);
    if (!host || host.socket !== ws) return;
    if (frame.t === "pong") return;
    if (frame.t?.startsWith("res")) return host.pending.get(frame.id)?.(frame);
    if (frame.t?.startsWith("ws-")) return host.sockets.get(frame.id)?.(frame);
  });
  const ping = setInterval(() => ws.readyState === 1 && ws.send(encodeFrame({ t: "ping" })), 25_000);
  ws.on("close", () => {
    clearInterval(ping);
    clearTimeout(hello);
    const host = hostId && hosts.get(hostId);
    if (!host || host.socket !== ws) return;
    hosts.delete(hostId);
    for (const handler of host.pending.values()) handler({ t: "res-error", message: "Hermes disconnected from the relay." });
    for (const handler of host.sockets.values()) handler({ t: "ws-close", code: 1012, reason: "Hermes disconnected" });
    log(`host ${hostId} disconnected`);
  });
}

function bridgeClient(client, host, path, req) {
  const id = host.nextId++;
  const queue = [];
  let open = false;
  host.sockets.set(id, (frame) => {
    if (frame.t === "ws-opened") {
      open = true;
      for (const item of queue.splice(0)) send(host, item);
    } else if (frame.t === "ws-msg") {
      if (client.readyState === 1) client.send(frame.binary ? Buffer.from(frame.data, "base64") : frame.data, { binary: !!frame.binary });
    } else if (frame.t === "ws-close") {
      host.sockets.delete(id);
      if (client.readyState <= 1) client.close(validCode(frame.code), String(frame.reason || "").slice(0, 120));
    }
  });
  send(host, { t: "ws-open", id, path, headers: { "x-forwarded-for": clientIp(req), "x-forwarded-proto": "https" } });
  client.on("message", (data, isBinary) => {
    const frame = { t: "ws-msg", id, binary: isBinary, data: isBinary ? Buffer.from(data).toString("base64") : data.toString() };
    if (open) send(host, frame);
    else queue.push(frame);
  });
  client.on("close", (code, reason) => {
    if (!host.sockets.has(id)) return;
    host.sockets.delete(id);
    send(host, { t: "ws-close", id, code: validCode(code), reason: reason.toString() });
  });
}

/** Close codes a peer may send (1005/1006 are reserved for "none"/"abnormal"). */
function validCode(code) {
  const n = Number(code);
  return n === 1000 || (n >= 1001 && n <= 1003) || (n >= 1007 && n <= 1014) || (n >= 3000 && n <= 4999) ? n : 1000;
}

server.listen(PORT, () => log(`Hermes Mobile relay listening on :${PORT}`));
