import { GatewayAuthError, passwordLogin, resolveWsUrl, rest } from "@/lib/gateway/rest";

type Call = { url: string; init: RequestInit };

function mockFetch(responses: { status: number; body?: unknown }[]) {
  const calls: Call[] = [];
  const queue = [...responses];
  global.fetch = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = queue.shift() ?? { status: 500 };
    return { status: next.status, ok: next.status < 400, text: async () => JSON.stringify(next.body ?? {}) } as Response;
  }) as unknown as typeof fetch;
  return calls;
}

const password = { url: "hermes.tail:9119", auth: "password" as const, username: "me", password: "pw" };

describe("rest (password backends)", () => {
  it("signs in again once when the cookie session has expired, then retries", async () => {
    const calls = mockFetch([{ status: 401 }, { status: 200, body: { ok: true } }, { status: 200, body: { profiles: [] } }]);
    await expect(rest(password, "/api/profiles")).resolves.toEqual({ profiles: [] });
    expect(calls.map((call) => call.url)).toEqual([
      "http://hermes.tail:9119/api/profiles",
      "http://hermes.tail:9119/auth/password-login",
      "http://hermes.tail:9119/api/profiles",
    ]);
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ provider: "basic", username: "me", password: "pw" });
    expect(calls[0].init.credentials).toBe("include");
  });

  it("reports rejected credentials plainly", async () => {
    mockFetch([{ status: 401, body: { detail: "Invalid credentials" } }]);
    await expect(passwordLogin(password)).rejects.toThrow("Hermes rejected that username or password.");
    mockFetch([{ status: 401 }, { status: 401 }]);
    await expect(rest(password, "/api/profiles")).rejects.toBeInstanceOf(GatewayAuthError);
  });

  it("mints a single-use ticket for the WebSocket; token backends stay synchronous", async () => {
    mockFetch([{ status: 200, body: { ticket: "t+1", ttl_seconds: 30 } }]);
    await expect(resolveWsUrl({ ...password, url: "https://h.ts.net" })).resolves.toBe("wss://h.ts.net/api/ws?ticket=t%2B1");
    expect(resolveWsUrl({ url: "http://127.0.0.1:9119", token: "a b" })).toBe("ws://127.0.0.1:9119/api/ws?token=a%20b");
  });

  it("sends the session token header on token backends", async () => {
    const calls = mockFetch([{ status: 200, body: [] }]);
    await rest({ url: "http://h", token: "tok" }, "/api/profiles");
    expect((calls[0].init.headers as Record<string, string>)["X-Hermes-Session-Token"]).toBe("tok");
  });
});
