#!/usr/bin/env node
/**
 * Hermes Mobile relay connector: runs next to Hermes and dials OUT to your relay (relay/server.mjs), so
 * the app can reach this Hermes at https://<relay>/h/<host-id> with no VPN and no open ports here.
 * Every HTTP request and WebSocket the relay hands over is replayed against the local dashboard; Hermes'
 * own password still guards all of it. No dependencies; Node 22+ (Hermes ships one).
 *
 * Env: RELAY_URL (https://relay.example.com), RELAY_TOKEN (the relay's secret), RELAY_HOST_ID (12-40
 * lowercase letters/digits), HERMES_URL (default http://127.0.0.1:9119), PUBLIC_HOST (the relay's host
 * name, sent to Hermes as Host like any reverse proxy would).
 *
 * Safety: it only ever connects while Hermes requires sign-in (GET /api/status -> auth_required: true).
 * An ungated Hermes serves its session token to anyone who loads the page, so the connector checks
 * before connecting and every 30 seconds, and drops the relay the moment Hermes isn't gated.
 */
import http from "node:http";

const RELAY_URL = (process.env.RELAY_URL || "").replace(/\/+$/, "");
const TOKEN = process.env.RELAY_TOKEN || "";
const HOST_ID = process.env.RELAY_HOST_ID || "";
const HERMES = new URL(process.env.HERMES_URL || "http://127.0.0.1:9119");
const PUBLIC_HOST = process.env.PUBLIC_HOST || (RELAY_URL ? new URL(RELAY_URL).host : "");
const CHUNK = 256 * 1024;

if (!RELAY_URL || !TOKEN || !/^[a-z0-9]{12,40}$/.test(HOST_ID)) {
  console.error("Set RELAY_URL, RELAY_TOKEN and RELAY_HOST_ID (12-40 lowercase letters/digits).");
  process.exit(1);
}
if (typeof WebSocket !== "function") {
  console.error("This Node has no built-in WebSocket; use Node 22 or newer.");
  process.exit(1);
}

const log = (...args) => console.log(new Date().toISOString(), ...args);
const DROP = new Set(["connection", "keep-alive", "transfer-encoding", "upgrade", "host", "content-length", "te", "trailer"]);

let relay = null;
let backoff = 1000;
let gated = false;

/** True only when Hermes answers /api/status with auth_required: true. */
function checkGate() {
  return new Promise((resolve) => {
    const req = http.get({ hostname: HERMES.hostname, port: HERMES.port || 80, path: "/api/status", timeout: 5000,
      headers: { host: PUBLIC_HOST || HERMES.host } }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(body).auth_required === true);
        } catch {
          resolve(false);
        }
      });
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => req.destroy());
  });
}
const requests = new Map(); // id -> http.ClientRequest
const sockets = new Map(); // id -> local WebSocket

function send(frame) {
  if (relay?.readyState === WebSocket.OPEN) relay.send(JSON.stringify(frame));
}

function forward(frame) {
  const headers = Object.fromEntries(Object.entries(frame.headers || {}).filter(([k]) => !DROP.has(k.toLowerCase())));
  const body = frame.body ? Buffer.from(frame.body, "base64") : null;
  if (body) headers["content-length"] = String(body.length);
  headers.host = PUBLIC_HOST || HERMES.host;
  const req = http.request(
    { hostname: HERMES.hostname, port: HERMES.port || 80, method: frame.method, path: frame.path, headers },
    (res) => {
      const out = {};
      for (const [k, v] of Object.entries(res.headers)) if (!DROP.has(k)) out[k] = v;
      send({ t: "res-head", id: frame.id, status: res.statusCode || 502, headers: out });
      res.on("data", (chunk) => {
        for (let i = 0; i < chunk.length; i += CHUNK) send({ t: "res-body", id: frame.id, data: chunk.subarray(i, i + CHUNK).toString("base64") });
      });
      res.on("end", () => {
        requests.delete(frame.id);
        send({ t: "res-end", id: frame.id });
      });
    },
  );
  req.on("error", (error) => {
    requests.delete(frame.id);
    send({ t: "res-error", id: frame.id, message: `Hermes is unreachable (${error.code || error.message}).` });
  });
  requests.set(frame.id, req);
  req.end(body || undefined);
}

function openSocket(frame) {
  const url = `${HERMES.protocol === "https:" ? "wss" : "ws"}://${HERMES.host}${frame.path}`;
  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  sockets.set(frame.id, ws);
  ws.onopen = () => send({ t: "ws-opened", id: frame.id });
  ws.onmessage = (event) => {
    const binary = typeof event.data !== "string";
    send({ t: "ws-msg", id: frame.id, binary, data: binary ? Buffer.from(event.data).toString("base64") : event.data });
  };
  ws.onclose = (event) => {
    if (!sockets.has(frame.id)) return;
    sockets.delete(frame.id);
    send({ t: "ws-close", id: frame.id, code: event.code, reason: event.reason });
  };
  ws.onerror = () => {};
}

function onFrame(frame) {
  switch (frame.t) {
    case "welcome":
      backoff = 1000;
      log(`connected: the app can reach this Hermes at ${RELAY_URL}/h/${HOST_ID}`);
      break;
    case "ping":
      send({ t: "pong" });
      break;
    case "req":
      forward(frame);
      break;
    case "req-cancel":
      requests.get(frame.id)?.destroy();
      requests.delete(frame.id);
      break;
    case "ws-open":
      openSocket(frame);
      break;
    case "ws-msg": {
      const ws = sockets.get(frame.id);
      if (ws?.readyState === WebSocket.OPEN) ws.send(frame.binary ? Buffer.from(frame.data, "base64") : frame.data);
      break;
    }
    case "ws-close": {
      const ws = sockets.get(frame.id);
      sockets.delete(frame.id);
      try {
        ws?.close(frame.code >= 3000 || frame.code === 1000 ? frame.code : 1000, frame.reason);
      } catch {
        ws?.close();
      }
      break;
    }
  }
}

async function connect() {
  gated = await checkGate();
  if (!gated) {
    log("Hermes isn't requiring sign-in (or isn't running); not exposing it through the relay. Retrying in 30s.");
    setTimeout(connect, 30_000);
    return;
  }
  const url = `${RELAY_URL.replace(/^http/, "ws")}/_connect`;
  relay = new WebSocket(url);
  relay.onopen = () => relay.send(JSON.stringify({ t: "hello", token: TOKEN, host: HOST_ID }));
  relay.onmessage = (event) => {
    try {
      onFrame(JSON.parse(String(event.data)));
    } catch (error) {
      log("bad frame:", error.message);
    }
  };
  relay.onclose = (event) => {
    for (const req of requests.values()) req.destroy();
    requests.clear();
    for (const ws of sockets.values()) ws.close();
    sockets.clear();
    if (event.code === 4401) log("the relay rejected this connector: check RELAY_TOKEN");
    log(`relay connection closed (${event.code}); retrying in ${Math.round(backoff / 1000)}s`);
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 60_000);
  };
  relay.onerror = () => {};
}

// Keep checking: if Hermes stops requiring sign-in, stop relaying immediately.
setInterval(async () => {
  const ok = await checkGate();
  if (!ok && gated && relay?.readyState === WebSocket.OPEN) {
    log("Hermes stopped requiring sign-in; disconnecting from the relay.");
    relay.close(4403, "hermes not gated");
  }
  gated = ok;
}, 30_000).unref();

connect();
