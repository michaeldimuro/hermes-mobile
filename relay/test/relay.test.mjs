// End to end: a stand-in Hermes <- connector (outbound) -> relay <- the "app" (HTTP + WebSocket).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import WebSocket, { WebSocketServer } from "ws";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const TOKEN = "test-relay-token-0123456789";
const HOST = "abcdef0123456789";
let hermes, hermesPort, relayPort, relayProc, connectorProc;
let lastHost = "";

const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
const freePort = async () => {
  const s = http.createServer();
  const port = await listen(s);
  await new Promise((r) => s.close(r));
  return port;
};
const waitFor = async (check, ms = 10_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("timed out");
};

before(async () => {
  hermes = http.createServer((req, res) => {
    lastHost = req.headers.host;
    if (req.url === "/api/status") return res.end(JSON.stringify({ auth_required: true, proto: req.headers["x-forwarded-proto"] }));
    if (req.url === "/big") return res.end(Buffer.alloc(1024 * 1024, 7));
    if (req.url?.startsWith("/auth/")) return res.writeHead(401).end();
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => res.writeHead(201, { "x-echo": "yes" }).end(`${req.method} ${req.url} ${body}`));
  });
  const wss = new WebSocketServer({ server: hermes });
  wss.on("connection", (ws, req) => ws.on("message", (m) => ws.send(`echo:${req.url}:${m}`)));
  hermesPort = await listen(hermes);

  relayPort = await freePort();
  relayProc = spawn(process.execPath, [here("../server.mjs")], { env: { ...process.env, PORT: String(relayPort), RELAY_TOKEN: TOKEN, RELAY_LOGIN_PER_MIN: "3" }, stdio: "ignore" });
  await waitFor(async () => (await fetch(`http://127.0.0.1:${relayPort}/healthz`)).ok);
  connectorProc = spawn(process.execPath, [here("../../server/connector/connector.mjs")], {
    env: { ...process.env, RELAY_URL: `http://127.0.0.1:${relayPort}`, RELAY_TOKEN: TOKEN, RELAY_HOST_ID: HOST,
      HERMES_URL: `http://127.0.0.1:${hermesPort}`, PUBLIC_HOST: "relay.example.com" },
    stdio: "ignore",
  });
  await waitFor(async () => (await (await fetch(`http://127.0.0.1:${relayPort}/healthz`)).json()).hosts === 1);
});

after(() => {
  relayProc?.kill();
  connectorProc?.kill();
  hermes?.close();
});

const base = () => `http://127.0.0.1:${relayPort}/h/${HOST}`;

test("forwards a request, as Hermes would see it from a reverse proxy", async () => {
  const res = await fetch(`${base()}/api/status`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { auth_required: true, proto: "https" });
  assert.equal(lastHost, "relay.example.com");
});

test("carries methods, bodies, status codes and headers", async () => {
  const res = await fetch(`${base()}/api/things?x=1`, { method: "POST", body: "hello", headers: { "content-type": "text/plain" } });
  assert.equal(res.status, 201);
  assert.equal(res.headers.get("x-echo"), "yes");
  assert.equal(await res.text(), "POST /api/things?x=1 hello");
});

test("streams large responses intact", async () => {
  const body = Buffer.from(await (await fetch(`${base()}/big`)).arrayBuffer());
  assert.equal(body.length, 1024 * 1024);
  assert.ok(body.every((b) => b === 7));
});

test("bridges WebSockets both ways", async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${relayPort}/h/${HOST}/api/ws?ticket=t`);
  await once(ws, "open");
  ws.send("ping");
  const [message] = await once(ws, "message");
  assert.equal(message.toString(), "echo:/api/ws?ticket=t:ping");
  ws.close();
});

test("unknown hosts get 502, not someone else's Hermes", async () => {
  assert.equal((await fetch(`http://127.0.0.1:${relayPort}/h/zzzzzzzzzzzzzz/api/status`)).status, 502);
  assert.equal((await fetch(`http://127.0.0.1:${relayPort}/h/../api/status`)).status, 404);
});

test("connectors need the relay token", async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${relayPort}/_connect`);
  await once(ws, "open");
  ws.send(JSON.stringify({ t: "hello", token: "wrong-token-wrong-token", host: "fffffffffffff1" }));
  const [code] = await once(ws, "close");
  assert.equal(code, 4401);
});

test("sign-in attempts are rate limited per client", async () => {
  const codes = [];
  for (let i = 0; i < 5; i++) codes.push((await fetch(`${base()}/auth/password-login`, { method: "POST", body: "{}" })).status);
  assert.deepEqual(codes, [401, 401, 401, 429, 429]);
});

test("never exposes a Hermes that doesn't require sign-in", async () => {
  // An ungated Hermes serves its session token on its page; the connector must refuse to relay it.
  const open = http.createServer((req, res) => res.end(req.url === "/api/status" ? '{"auth_required":false}' : "secret page"));
  const port = await listen(open);
  const proc = spawn(process.execPath, [here("../../server/connector/connector.mjs")], {
    env: { ...process.env, RELAY_URL: `http://127.0.0.1:${relayPort}`, RELAY_TOKEN: TOKEN, RELAY_HOST_ID: "ungated000000001",
      HERMES_URL: `http://127.0.0.1:${port}` },
    stdio: "ignore",
  });
  try {
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal((await fetch(`http://127.0.0.1:${relayPort}/h/ungated000000001/`)).status, 502);
  } finally {
    proc.kill();
    open.close();
  }
});
