import { resolveWsUrl } from "./rest";
import type {
  ConnectionState,
  GatewayConfig,
  GatewayEvent,
  ServerRequest,
} from "./types";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  /** Written to a socket; only these fail when that socket drops. Unsent calls wait for a reconnect. */
  sent: boolean;
};

type Queued = { line: string; id?: number };

type Frame = {
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string };
};

export type SocketFactory = (url: string) => WebSocket;
/** Sync for token auth; async for password auth (mints a single-use WebSocket ticket first). */
export type UrlResolver = (config: GatewayConfig) => string | Promise<string>;

const HEARTBEAT_INTERVAL_MS = 15_000;
const HEARTBEAT_DEADLINE_MS = 45_000;
const MAX_BACKOFF_MS = 10_000;
const CONNECT_TIMEOUT_MS = 10_000;

export class RpcError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

/**
 * JSON-RPC 2.0 client for the Hermes gateway WebSocket (`/api/ws`).
 *
 * - Routes responses, `event` notifications and server→client requests.
 * - Advertises `client.capabilities {server_requests: true}` on `gateway.ready`
 *   so approvals / clarify / secrets reach the app instead of failing fast.
 * - Reconnects with backoff, keeps a `gateway.ping` heartbeat and replays
 *   missed per-session events via `session.events.since`.
 */
export class GatewayClient {
  private socket: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number | string, Pending>();
  private outbox: Queued[] = [];
  private eventListeners = new Set<(event: GatewayEvent) => void>();
  private requestListeners = new Set<(request: ServerRequest) => void>();
  private stateListeners = new Set<(state: ConnectionState) => void>();
  private lastSeq = new Map<string, number>();
  private replayEpoch: string | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private lastInbound = 0;
  private attempts = 0;
  /** Consecutive connection attempts that failed before opening (reset on open). */
  failures = 0;
  private disposed = false;
  private hasConnected = false;
  /** Bumped per connect attempt so a slow ticket fetch can't open a stale socket. */
  private attempt = 0;
  private resolving = false;
  state: ConnectionState = "idle";

  constructor(
    private readonly config: GatewayConfig,
    private readonly createSocket: SocketFactory = (url) => new WebSocket(url),
    private readonly resolveUrl: UrlResolver = resolveWsUrl,
  ) {}

  connect() {
    if (this.disposed || this.socket || this.resolving) return;
    this.setState(this.hasConnected ? "reconnecting" : "connecting");
    const attempt = ++this.attempt;
    let target: string | Promise<string>;
    try {
      target = this.resolveUrl(this.config);
    } catch {
      this.failures += 1;
      this.scheduleReconnect();
      return;
    }
    if (typeof target === "string") return this.open(target);
    this.resolving = true;
    target.then(
      (url) => {
        this.resolving = false;
        if (!this.disposed && attempt === this.attempt && !this.socket) this.open(url);
      },
      () => {
        this.resolving = false;
        if (this.disposed || attempt !== this.attempt) return;
        this.failures += 1;
        this.scheduleReconnect();
      },
    );
  }

  private open(url: string) {
    let socket: WebSocket;
    try {
      socket = this.createSocket(url);
    } catch {
      this.failures += 1;
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    // A handshake to an unreachable host can hang in CONNECTING without ever firing close/error.
    this.connectTimer = setTimeout(() => {
      this.connectTimer = null;
      if (this.socket === socket && socket.readyState !== 1) this.handleDrop(socket);
    }, CONNECT_TIMEOUT_MS);
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.clearConnectTimer();
      this.attempts = 0;
      this.failures = 0;
      this.hasConnected = true;
      this.lastInbound = Date.now();
      const queued = this.outbox;
      this.outbox = [];
      for (const item of queued) {
        socket.send(item.line);
        const call = item.id !== undefined ? this.pending.get(item.id) : undefined;
        if (call) call.sent = true;
      }
      this.setState("open");
    };
    socket.onmessage = (message) => {
      if (this.socket !== socket) return;
      this.lastInbound = Date.now();
      this.handleFrame(String(message.data));
    };
    socket.onclose = () => this.handleDrop(socket);
    socket.onerror = () => this.handleDrop(socket);
  }

  /** Force a fresh connection now (e.g. app returned to foreground). */
  wake() {
    if (this.disposed) return;
    if (this.state === "open" && Date.now() - this.lastInbound < HEARTBEAT_DEADLINE_MS) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.socket) this.dropSocket();
    this.connect();
  }

  /** User-initiated retry: skip the backoff and reset it. */
  retryNow() {
    if (this.disposed || this.state === "open") return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.attempts = 0;
    if (this.socket) this.dropSocket();
    this.connect();
  }

  /** (Re)start after `stop()`; idempotent. */
  start() {
    this.disposed = false;
    this.connect();
  }

  /** Close the socket and cancel timers. Listeners stay registered (their owners unsubscribe),
   *  so a stopped client can be started again — e.g. React StrictMode re-running effects. */
  stop() {
    this.disposed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.dropSocket();
    this.failAll(new Error("Gateway connection closed"));
    this.setState("closed");
  }

  request<T>(method: string, params: Record<string, unknown> = {}, timeoutMs = 30_000) {
    return new Promise<T>((resolve, reject) => {
      if (this.disposed) return reject(new Error("Gateway connection closed"));
      const id = this.nextId++;
      const timer = setTimeout(() => {
        const call = this.pending.get(id);
        this.pending.delete(id);
        this.outbox = this.outbox.filter((item) => item.id !== id);
        reject(
          new RpcError(call?.sent ? `Hermes didn't answer ${method} in time` : "Couldn't reach Hermes. Check the connection and try again."),
        );
      }, timeoutMs);
      const entry: Pending = { resolve: resolve as (v: unknown) => void, reject, timer, sent: false };
      this.pending.set(id, entry);
      entry.sent = this.send({ jsonrpc: "2.0", id, method, params }, id);
      if (!this.socket && !this.reconnectTimer) this.connect();
    });
  }

  /** Answer a server→client request (approval, clarify, sudo, secret, …). */
  respond(id: string, result: Record<string, unknown>) {
    this.send({ jsonrpc: "2.0", id, result });
  }

  decline(id: string, message = "Declined on mobile") {
    this.send({ jsonrpc: "2.0", id, error: { code: -32000, message } });
  }

  onEvent(listener: (event: GatewayEvent) => void) {
    this.eventListeners.add(listener);
    return () => void this.eventListeners.delete(listener);
  }

  onRequest(listener: (request: ServerRequest) => void) {
    this.requestListeners.add(listener);
    return () => void this.requestListeners.delete(listener);
  }

  onState(listener: (state: ConnectionState) => void) {
    this.stateListeners.add(listener);
    return () => void this.stateListeners.delete(listener);
  }

  /** Track a session so dropped events are replayed after a reconnect. */
  track(sessionId: string) {
    if (!this.lastSeq.has(sessionId)) this.lastSeq.set(sessionId, 0);
  }

  untrack(sessionId: string) {
    this.lastSeq.delete(sessionId);
  }

  /** Visible for tests: route one inbound text frame. */
  handleFrame(text: string) {
    let frame: Frame;
    try {
      frame = JSON.parse(text);
    } catch {
      return;
    }
    if (!frame || typeof frame !== "object") return;

    if (typeof frame.id === "string" && typeof frame.method === "string" && frame.method !== "event") {
      const request: ServerRequest = {
        id: frame.id,
        method: frame.method,
        params: (frame.params as Record<string, any>) ?? {},
      };
      if (this.requestListeners.size === 0) return this.decline(request.id, `No handler for ${request.method}`);
      this.requestListeners.forEach((listener) => listener(request));
      return;
    }

    if (frame.id !== undefined && frame.id !== null && !frame.method) {
      const call = this.pending.get(frame.id);
      if (!call) return;
      this.pending.delete(frame.id);
      clearTimeout(call.timer);
      if (frame.error) call.reject(new RpcError(frame.error.message ?? "Gateway error", frame.error.code));
      else {
        this.deliverOpenRequests(frame.result);
        call.resolve(frame.result);
      }
      return;
    }

    if (frame.method === "event" && frame.params && typeof (frame.params as GatewayEvent).type === "string") {
      this.dispatchEvent(frame.params as GatewayEvent);
    }
  }

  private dispatchEvent(event: GatewayEvent) {
    const sid = event.session_id;
    if (sid && typeof event.seq === "number" && this.lastSeq.has(sid)) {
      if (event.seq <= (this.lastSeq.get(sid) ?? 0)) return; // duplicate from replay
      this.lastSeq.set(sid, event.seq);
    }
    if (event.type === "gateway.ready") this.onReady(event.payload ?? {});
    this.eventListeners.forEach((listener) => listener(event));
  }

  private onReady(payload: { replay_epoch?: string; heartbeat?: boolean | null }) {
    this.request("client.capabilities", { server_requests: true }).catch(() => undefined);
    if (payload.heartbeat) this.startHeartbeat();
    const epoch = payload.replay_epoch ?? null;
    const restarted = this.replayEpoch !== null && epoch !== this.replayEpoch;
    this.replayEpoch = epoch;
    if (restarted) {
      for (const sid of this.lastSeq.keys()) this.lastSeq.set(sid, 0);
      return;
    }
    for (const [sid, lastSeen] of this.lastSeq) {
      if (lastSeen <= 0) continue;
      this.request<{ events?: GatewayEvent[] }>("session.events.since", { session_id: sid, last_seen: lastSeen })
        .then((result) => (result.events ?? []).forEach((event) => this.dispatchEvent({ session_id: sid, ...event })))
        .catch(() => undefined);
    }
  }

  private deliverOpenRequests(result: unknown) {
    const open = (result as { open_requests?: unknown } | null)?.open_requests;
    if (!Array.isArray(open)) return;
    for (const entry of open) {
      if (typeof entry?.id === "string" && typeof entry?.method === "string")
        this.requestListeners.forEach((listener) =>
          listener({ id: entry.id, method: entry.method, params: entry.params ?? {} }),
        );
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    const socket = this.socket;
    this.heartbeat = setInterval(() => {
      if (this.socket !== socket || !socket) return this.stopHeartbeat();
      if (Date.now() - this.lastInbound > HEARTBEAT_DEADLINE_MS) return this.handleDrop(socket);
      try {
        socket.send(JSON.stringify({ jsonrpc: "2.0", id: `hb-${Date.now()}`, method: "gateway.ping", params: {} }));
      } catch {
        this.handleDrop(socket);
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  /** Write now if open (returns true), else queue for the next connection. */
  private send(frame: Record<string, unknown>, id?: number) {
    const line = JSON.stringify(frame);
    if (this.socket && this.socket.readyState === 1) {
      try {
        this.socket.send(line);
        return true;
      } catch {
        // fall through to queue; the drop handler reconnects
      }
    }
    this.outbox.push({ line, id });
    return false;
  }

  private clearConnectTimer() {
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = null;
  }

  private scheduleReconnect() {
    if (this.disposed || this.reconnectTimer) return;
    this.setState("reconnecting");
    const delay = Math.min(MAX_BACKOFF_MS, 500 * 2 ** this.attempts++);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private handleDrop(socket: WebSocket) {
    if (this.socket !== socket) return;
    const wasOpen = socket.readyState === 1 || this.state === "open";
    if (!wasOpen) this.failures += 1;
    this.dropSocket();
    this.failSent(new Error("Connection to Hermes was interrupted"));
    this.scheduleReconnect();
  }

  private dropSocket() {
    this.stopHeartbeat();
    this.clearConnectTimer();
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
    try {
      socket.close();
    } catch {
      // already closed
    }
  }

  /** Reject calls that went out on the dead socket; unsent calls stay queued for the next one. */
  private failSent(error: Error) {
    for (const [id, call] of this.pending) {
      if (!call.sent) continue;
      clearTimeout(call.timer);
      this.pending.delete(id);
      call.reject(error);
    }
    // Answers to server requests belong to the dead generation (they are replayed on resume).
    this.outbox = this.outbox.filter((item) => item.id !== undefined);
  }

  private failAll(error: Error) {
    for (const call of this.pending.values()) {
      clearTimeout(call.timer);
      call.reject(error);
    }
    this.pending.clear();
    this.outbox = [];
  }

  private setState(state: ConnectionState) {
    if (this.state === state) return;
    this.state = state;
    this.stateListeners.forEach((listener) => listener(state));
  }
}
