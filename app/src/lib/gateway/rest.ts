import type { GatewayConfig } from "./types";

export function normalizeGatewayUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

const isPassword = (config: GatewayConfig): config is Extract<GatewayConfig, { auth: "password" }> =>
  config.auth === "password";

export class GatewayAuthError extends Error {
  readonly status = 401;
  constructor(message = "Gateway rejected this token. Enter the current dashboard session token.") {
    super(message);
    this.name = "GatewayAuthError";
  }
}

/** Public backend description (`GET /api/status`, no auth): tells the app how to sign in. */
export type AuthProbe = { authRequired: boolean; providers: string[]; version?: string };

export async function probeGateway(url: string): Promise<AuthProbe> {
  const status = await rawFetch<{ auth_required?: boolean; auth_providers?: string[]; version?: string }>(
    normalizeGatewayUrl(url),
    "/api/status",
    {},
  );
  return { authRequired: Boolean(status?.auth_required), providers: status?.auth_providers ?? [], version: status?.version };
}

async function rawFetch<T>(base: string, path: string, init: RequestInit, timeoutMs = 10_000): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}${path}`, {
      ...init,
      // Password sessions live in cookies (the native cookie store keeps them); harmless for tokens.
      credentials: "include",
      signal: init.signal ?? controller.signal,
      headers: { Accept: "application/json", "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (response.status === 401 || response.status === 403) throw new GatewayAuthError(detailOf(body) || undefined);
    if (!response.ok) throw new Error(detailOf(body) || `Gateway request failed (${response.status})`);
    return body as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("Gateway did not respond in time.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

const detailOf = (body: unknown) =>
  body && typeof body === "object" && "detail" in body ? String((body as { detail: unknown }).detail) : "";

/** Username/password sign-in against the basic provider; the session arrives as cookies. */
export async function passwordLogin(config: Extract<GatewayConfig, { auth: "password" }>) {
  try {
    await rawFetch(normalizeGatewayUrl(config.url), "/auth/password-login", {
      method: "POST",
      body: JSON.stringify({ provider: "basic", username: config.username, password: config.password }),
    });
  } catch (error) {
    if (error instanceof GatewayAuthError) throw new GatewayAuthError("Hermes rejected that username or password.");
    throw error;
  }
}

/** Authenticated REST call against the Hermes dashboard API (re-signs in once on an expired session). */
export async function rest<T>(config: GatewayConfig, path: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<T> {
  const base = normalizeGatewayUrl(config.url);
  if (!isPassword(config)) {
    return rawFetch<T>(base, path, { ...init, headers: { "X-Hermes-Session-Token": config.token, ...(init.headers ?? {}) } }, timeoutMs);
  }
  try {
    return await rawFetch<T>(base, path, init, timeoutMs);
  } catch (error) {
    if (!(error instanceof GatewayAuthError)) throw error;
    await passwordLogin(config);
    return rawFetch<T>(base, path, init, timeoutMs);
  }
}

/**
 * WebSocket URL for the gateway. Token backends take `?token=`; password (gated) backends refuse
 * that and need a fresh single-use ticket per connection (`POST /api/auth/ws-ticket`, 30s TTL).
 */
export function resolveWsUrl(config: GatewayConfig, path = "/api/ws"): string | Promise<string> {
  const base = normalizeGatewayUrl(config.url).replace(/^http/i, "ws");
  const join = path.includes("?") ? "&" : "?";
  if (!isPassword(config)) return `${base}${path}${join}token=${encodeURIComponent(config.token)}`;
  return rest<{ ticket: string }>(config, "/api/auth/ws-ticket", { method: "POST" }).then(
    ({ ticket }) => `${base}${path}${join}ticket=${encodeURIComponent(ticket)}`,
  );
}

/**
 * Headers that authenticate a request made outside `rest()` (downloads, media players).
 * Token backends need the session header; password backends authenticate with the session
 * cookies the native networking stack already holds, so there is nothing to add.
 */
export function authHeaders(config: GatewayConfig): Record<string, string> {
  return isPassword(config) ? {} : { "X-Hermes-Session-Token": config.token };
}
