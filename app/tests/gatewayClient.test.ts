import { GatewayClient } from "@/lib/gateway/client";

class FakeSocket {
  static last: FakeSocket;
  readyState = 0;
  sent: any[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.last = this;
  }
  send(line: string) {
    this.sent.push(JSON.parse(line));
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

const makeClient = () =>
  new GatewayClient({ url: "http://host:9119", token: "t k" }, (url) => new FakeSocket(url) as unknown as WebSocket);

describe("GatewayClient", () => {
  it("builds an authenticated ws url and queues requests until open", async () => {
    const client = makeClient();
    const pending = client.request<{ ok: boolean }>("session.list", { limit: 5 });
    const socket = FakeSocket.last;
    expect(socket.url).toBe("ws://host:9119/api/ws?token=t%20k");
    expect(socket.sent).toHaveLength(0);
    socket.open();
    expect(socket.sent[0]).toMatchObject({ method: "session.list", params: { limit: 5 } });
    socket.receive({ jsonrpc: "2.0", id: socket.sent[0].id, result: { ok: true } });
    await expect(pending).resolves.toEqual({ ok: true });
    client.stop();
  });

  it("routes events, advertises capabilities on ready and drops replayed duplicates", () => {
    const client = makeClient();
    const events: string[] = [];
    client.onEvent((event) => events.push(`${event.type}:${event.seq ?? ""}`));
    client.connect();
    const socket = FakeSocket.last;
    socket.open();
    socket.receive({ jsonrpc: "2.0", method: "event", params: { type: "gateway.ready", payload: { replay_epoch: "e1" } } });
    expect(socket.sent.some((frame) => frame.method === "client.capabilities")).toBe(true);

    client.track("s1");
    const delta = { type: "message.delta", session_id: "s1", seq: 4, payload: { text: "a" } };
    socket.receive({ jsonrpc: "2.0", method: "event", params: delta });
    socket.receive({ jsonrpc: "2.0", method: "event", params: delta });
    expect(events).toEqual(["gateway.ready:", "message.delta:4"]);
    client.stop();
  });

  it("hands server requests to listeners and sends answers back", () => {
    const client = makeClient();
    const seen: string[] = [];
    client.onRequest((request) => seen.push(`${request.method}:${request.id}`));
    client.connect();
    const socket = FakeSocket.last;
    socket.open();
    socket.receive({ jsonrpc: "2.0", id: "srq-1", method: "approval", params: { command: "rm -rf build" } });
    expect(seen).toEqual(["approval:srq-1"]);
    client.respond("srq-1", { choice: "once" });
    expect(socket.sent.pop()).toEqual({ jsonrpc: "2.0", id: "srq-1", result: { choice: "once" } });
    client.stop();
  });

  it("can be restarted after stop (StrictMode effect re-run)", () => {
    const client = makeClient();
    const events: string[] = [];
    client.onEvent((event) => events.push(event.type));
    client.start();
    client.stop();
    client.start();
    const socket = FakeSocket.last;
    socket.open();
    socket.receive({ jsonrpc: "2.0", method: "event", params: { type: "sessions.changed", payload: {} } });
    expect(events).toEqual(["sessions.changed"]);
    expect(client.state).toBe("open");
    client.stop();
  });

  it("rejects in-flight calls and reconnects after a drop", async () => {
    jest.useFakeTimers();
    const client = makeClient();
    const states: string[] = [];
    client.onState((state) => states.push(state));
    const pending = client.request("ping");
    const first = FakeSocket.last;
    first.open();
    first.onclose?.();
    await expect(pending).rejects.toThrow(/interrupted/);
    jest.advanceTimersByTime(600);
    expect(FakeSocket.last).not.toBe(first);
    expect(states).toEqual(["connecting", "open", "reconnecting"]);
    client.stop();
    jest.useRealTimers();
  });

  it("keeps unsent calls queued across a failed attempt and delivers them after reconnect", async () => {
    jest.useFakeTimers();
    const client = makeClient();
    const pending = client.request<{ n: number }>("model.options", { explicit_only: true });
    const first = FakeSocket.last;
    first.onerror?.(); // handshake failed before opening (e.g. gateway restarting)
    expect(client.failures).toBe(1);
    jest.advanceTimersByTime(600);
    const second = FakeSocket.last;
    expect(second).not.toBe(first);
    second.open();
    expect(second.sent[0]).toMatchObject({ method: "model.options" });
    second.receive({ jsonrpc: "2.0", id: second.sent[0].id, result: { n: 3 } });
    await expect(pending).resolves.toEqual({ n: 3 });
    expect(client.failures).toBe(0);
    client.stop();
    jest.useRealTimers();
  });

  it("gives up on a handshake that never completes and retries", () => {
    jest.useFakeTimers();
    const client = makeClient();
    client.connect();
    const hung = FakeSocket.last;
    jest.advanceTimersByTime(10_000);
    expect(client.state).toBe("reconnecting");
    expect(client.failures).toBe(1);
    jest.advanceTimersByTime(600);
    expect(FakeSocket.last).not.toBe(hung);
    client.stop();
    jest.useRealTimers();
  });

  it("explains unreachable gateways when a queued call times out", async () => {
    jest.useFakeTimers();
    const client = makeClient();
    const pending = client.request("profiles.list", {}, 5_000);
    jest.advanceTimersByTime(5_000);
    await expect(pending).rejects.toThrow(/Couldn't reach Hermes/);
    client.stop();
    jest.useRealTimers();
  });

  it("mints a ticket URL asynchronously for password backends and retries if minting fails", async () => {
    jest.useFakeTimers();
    let calls = 0;
    const client = new GatewayClient(
      { url: "https://h", auth: "password", username: "u", password: "p" },
      (url) => new FakeSocket(url) as unknown as WebSocket,
      () => (++calls === 1 ? Promise.reject(new Error("offline")) : Promise.resolve("wss://h/api/ws?ticket=abc")),
    );
    client.connect();
    await Promise.resolve();
    await Promise.resolve();
    expect(client.failures).toBe(1);
    jest.advanceTimersByTime(600);
    await Promise.resolve();
    await Promise.resolve();
    expect(FakeSocket.last.url).toBe("wss://h/api/ws?ticket=abc");
    client.stop();
    jest.useRealTimers();
  });
});
