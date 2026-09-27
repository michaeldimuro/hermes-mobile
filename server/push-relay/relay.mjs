#!/usr/bin/env node
/**
 * Hermes Mobile push relay: runs next to Hermes on your Mac and turns Hermes activity into phone
 * notifications (Expo push service). No dependencies; Node 22+.
 *
 *   Bot replies        a session gained messages and the newest one is from the bot
 *   Automations        a cron job ran (finished or failed)
 *   Boards             more Kanban tasks waiting in Review or Blocked
 *
 * Phones register themselves from the app (Settings → Notifications), which stores their Expo
 * push tokens in the default profile's ui_meta["hermes-mobile-push"]; the relay reads them there.
 *
 * Config (env): HERMES_URL (default http://127.0.0.1:9119), HERMES_TOKEN (dashboard session token;
 * read from the local dashboard page when unset), or HERMES_USERNAME + HERMES_PASSWORD for a
 * password-gated backend. RELAY_POLL_SECONDS (default 20). State: ~/.hermes/mobile-push-relay.json
 * (RELAY_STATE overrides). RELAY_DRY_RUN=1 logs notifications instead of sending them.
 */
import { readdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const BASE = (process.env.HERMES_URL || "http://127.0.0.1:9119").replace(/\/+$/, "");
const POLL_MS = Math.max(5, Number(process.env.RELAY_POLL_SECONDS || 20)) * 1000;
const STATE_FILE = process.env.RELAY_STATE || join(homedir(), ".hermes", "mobile-push-relay.json");
const EXPO_PUSH = "https://exp.host/--/api/v2/push/send";
const PUSH_KEY = "hermes-mobile-push";
const BOT_CHAT = "Bot Chat";

/** Every request gives up after this long, so one stuck Hermes endpoint can't stall the relay. */
const REQUEST_TIMEOUT_MS = 15_000;
const timeout = () => AbortSignal.timeout(REQUEST_TIMEOUT_MS);

const log = (...args) => console.log(new Date().toISOString(), ...args);

// ── auth ──────────────────────────────────────────────────────────────────────────────────────
let token = process.env.HERMES_TOKEN || "";
let cookie = "";

async function authenticate() {
  if (process.env.HERMES_USERNAME && process.env.HERMES_PASSWORD) {
    const res = await fetch(`${BASE}/auth/password-login`, {
      method: "POST",
      signal: timeout(),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "basic", username: process.env.HERMES_USERNAME, password: process.env.HERMES_PASSWORD }),
    });
    if (!res.ok) throw new Error(`password login failed (${res.status})`);
    cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
    return;
  }
  if (process.env.HERMES_TOKEN) return;
  // Loopback dashboards embed their (rotating) session token in the page.
  const html = await (await fetch(`${BASE}/`, { signal: timeout() })).text();
  const found = html.match(/__HERMES_SESSION_TOKEN__\s*=\s*"([^"]+)"/)?.[1];
  if (!found) throw new Error("no dashboard token found; set HERMES_TOKEN or HERMES_USERNAME/HERMES_PASSWORD");
  token = found;
}

async function api(path) {
  const headers = { Accept: "application/json", ...(token ? { "X-Hermes-Session-Token": token } : {}), ...(cookie ? { Cookie: cookie } : {}) };
  let res = await fetch(`${BASE}${path}`, { headers, signal: timeout() });
  if (res.status === 401 || res.status === 403) {
    await authenticate(); // token rotated with a Hermes restart, or the session expired
    res = await fetch(`${BASE}${path}`, {
      headers: { ...headers, ...(token ? { "X-Hermes-Session-Token": token } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      signal: timeout(),
    });
  }
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

/** One JSON-RPC call over a short-lived socket (profiles.list carries ui_meta; REST doesn't). */
async function rpc(method, params) {
  let url = `${BASE.replace(/^http/, "ws")}/api/ws`;
  if (cookie) {
    const res = await fetch(`${BASE}/api/auth/ws-ticket`, { method: "POST", headers: { Cookie: cookie }, signal: timeout() });
    url += `?ticket=${encodeURIComponent((await res.json()).ticket)}`;
  } else url += `?token=${encodeURIComponent(token)}`;
  const ws = new WebSocket(url);
  try {
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () => reject(new Error("websocket failed"));
    });
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 20_000);
      ws.onmessage = (message) => {
        const frame = JSON.parse(String(message.data));
        if (frame.id !== "relay-1") return;
        clearTimeout(timer);
        frame.error ? reject(new Error(frame.error.message)) : resolve(frame.result);
      };
      ws.send(JSON.stringify({ jsonrpc: "2.0", id: "relay-1", method, params }));
    });
  } finally {
    ws.close();
  }
}

// ── state ─────────────────────────────────────────────────────────────────────────────────────
function loadState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { primed: false, sessions: {}, cron: {}, boards: {} };
  }
}
function saveState(state) {
  writeFileSync(`${STATE_FILE}.tmp`, JSON.stringify(state));
  renameSync(`${STATE_FILE}.tmp`, STATE_FILE);
}

// ── push ──────────────────────────────────────────────────────────────────────────────────────
async function devices() {
  const result = await rpc("profiles.list", { include_sessions: false });
  const row = (result.profiles ?? []).find((p) => p.name === "default");
  const list = row?.ui_meta?.[PUSH_KEY]?.devices;
  return Array.isArray(list) ? list.map((d) => d.token).filter(Boolean) : [];
}

async function push(tokens, notes) {
  if (!tokens.length || !notes.length) return;
  const messages = notes.flatMap((note) =>
    tokens.map((to) => ({ to, title: note.title, body: note.body.slice(0, 180), data: { url: note.url }, sound: "default", threadId: note.thread })),
  );
  for (let i = 0; i < messages.length; i += 100) {
    const res = await fetch(EXPO_PUSH, {
      method: "POST",
      signal: timeout(),
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(messages.slice(i, i + 100)),
    });
    const body = await res.json().catch(() => ({}));
    for (const ticket of body.data ?? []) if (ticket.status === "error") log("push error:", ticket.message);
  }
  log(`sent ${notes.length} notification(s) to ${tokens.length} device(s)`);
}

// ── watchers ──────────────────────────────────────────────────────────────────────────────────
const titleOf = (profiles, name) => {
  const row = profiles.find((p) => p.name === name);
  return row?.display_name || row?.bot_title || (name === "default" ? "Hermes" : name.replace(/(^|[-_])(\w)/g, (_m, sep, c) => (sep ? " " : "") + c.toUpperCase()));
};
const clean = (text) => String(text ?? "").replace(/[`*_#>]/g, "").replace(/\s+/g, " ").trim();

async function watchSessions(state, profiles, notes) {
  const page = await api("/api/profiles/sessions?profile=all&order=recent&min_messages=1&archived=exclude&limit=40&exclude_sources=cron");
  for (const row of page.sessions ?? []) {
    const title = String(row.title ?? "");
    if (title.startsWith("Group:")) continue; // group-chat plumbing; the room itself is what matters
    const key = `${row.profile}:${row.id}`;
    const count = Number(row.message_count ?? 0);
    const before = state.sessions[key];
    state.sessions[key] = count;
    // A session new to the window (just created, or old and active again) counts from zero.
    if (!state.primed || count <= (before ?? 0)) continue;
    const last = await api(`/api/sessions/${encodeURIComponent(row.id)}/messages?profile=${encodeURIComponent(row.profile)}&order=latest&limit=2`).catch(() => null);
    const message = last?.messages?.[last.messages.length - 1];
    if (!message || message.role !== "assistant" || !clean(message.content)) continue;
    const bot = titleOf(profiles, row.profile);
    const canonical = title === BOT_CHAT;
    notes.push({
      title: canonical ? bot : `${bot} · ${title || "Chat"}`,
      body: clean(message.content),
      url: canonical ? `/bot/${encodeURIComponent(row.profile)}` : `/chat/${encodeURIComponent(row.id)}?profile=${encodeURIComponent(row.profile)}`,
      thread: key,
    });
  }
}

async function watchCron(state, profiles, notes) {
  const jobs = await api("/api/cron/jobs?profile=all");
  for (const job of Array.isArray(jobs) ? jobs : []) {
    const key = `${job.profile ?? "default"}:${job.id}`;
    const ran = job.last_run_at ?? null;
    const before = state.cron[key];
    state.cron[key] = ran;
    if (!state.primed || !ran || ran === before) continue;
    const failed = job.last_status && !/ok|success|complete/i.test(job.last_status);
    notes.push({
      title: `${titleOf(profiles, job.profile ?? "default")} · ${job.name || "Automation"}`,
      body: failed ? `Failed: ${clean(job.last_error) || job.last_status}` : "Finished its scheduled run.",
      url: "/settings/automations",
      thread: `cron:${key}`,
    });
  }
}

async function watchBoards(state, notes) {
  let { boards } = await api("/api/plugins/kanban/boards").catch(() => ({ boards: null }));
  if (!boards) {
    // The list route can hang (seen on Hermes 0.21.5); count the boards we already know one by one.
    boards = [];
    const onDisk = (() => {
      try {
        return ["default", ...readdirSync(join(homedir(), ".hermes", "kanban", "boards"))];
      } catch {
        return [];
      }
    })();
    for (const slug of new Set([...Object.keys(state.boards), ...onDisk])) {
      const board = await api(`/api/plugins/kanban/board?board=${encodeURIComponent(slug)}`).catch(() => null);
      if (!board) continue;
      const counts = Object.fromEntries((board.columns ?? []).map((c) => [c.name, c.tasks.length]));
      boards.push({ slug, name: state.boardNames?.[slug] ?? slug, counts });
    }
  }
  state.boardNames = { ...(state.boardNames ?? {}), ...Object.fromEntries(boards.map((b) => [b.slug, b.name])) };
  for (const board of boards) {
    const waiting = Number(board.counts?.review ?? 0) + Number(board.counts?.blocked ?? 0);
    const before = state.boards[board.slug];
    state.boards[board.slug] = waiting;
    if (!state.primed || before === undefined || waiting <= before) continue;
    notes.push({
      title: `${board.name} board`,
      body: `${waiting - before} more task${waiting - before === 1 ? "" : "s"} waiting on you (review or blocked).`,
      url: `/boards/${encodeURIComponent(board.slug)}`,
      thread: `board:${board.slug}`,
    });
  }
}

async function tick(state) {
  const notes = [];
  const profiles = (await api("/api/profiles").catch(() => [])) ?? [];
  const rows = Array.isArray(profiles) ? profiles : profiles.profiles ?? [];
  await watchSessions(state, rows, notes);
  await watchCron(state, rows, notes).catch((e) => log("cron:", e.message));
  await watchBoards(state, notes).catch((e) => log("boards:", e.message));
  if (notes.length && process.env.RELAY_DRY_RUN) for (const note of notes) log("would notify:", JSON.stringify(note));
  else if (notes.length) await push(await devices(), notes);
  state.primed = true; // the first pass only learns what already exists: no flood on start
  saveState(state);
}

async function main() {
  await authenticate();
  const state = loadState();
  log(`relay watching ${BASE} every ${POLL_MS / 1000}s`);
  for (;;) {
    try {
      await tick(state);
    } catch (error) {
      log("tick failed:", error.message);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

if (process.argv.includes("--once")) {
  await authenticate();
  const state = loadState();
  await tick(state);
  log("devices registered:", (await devices()).length);
} else {
  await main();
}
