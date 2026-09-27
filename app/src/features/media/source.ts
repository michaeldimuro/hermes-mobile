/**
 * Maps a file reference to an HTTP request. Gateway files go through the authenticated
 * `GET /api/fs/download?path=&profile=&session_id=` route (the one Hermes Desktop uses for remote
 * artifacts): any regular file the gateway user can read, sensitive-file denylist enforced server
 * side, HTTP Range supported (so video/audio can stream), header auth only (`?token=` is NOT
 * accepted there). Password-auth backends authenticate by session cookie instead (`cookieAuth`),
 * so those downloads go through `fetch(credentials: "include")` and players can't stream directly.
 * Remote http(s) files are fetched directly and never get gateway credentials.
 */
import { authHeaders, normalizeGatewayUrl } from "@/lib/gateway/rest";
import type { GatewayConfig } from "@/lib/gateway/types";
import { extensionOf, fileNameOf, kindOf, type MediaKind } from "./kinds";

export type FileRef =
  | { path: string; profile?: string | null; sessionId?: string | null; url?: undefined }
  | { url: string; path?: undefined };

export type FileRequest = {
  url: string;
  headers: Record<string, string>;
  /** Stable, filesystem-safe cache file name (hash + extension). */
  cacheName: string;
  name: string;
  kind: MediaKind;
  authenticated: boolean;
  /** Gateway session is a cookie (password auth): needs fetch with credentials, no header streaming. */
  cookieAuth: boolean;
};

/** 53-bit FNV-1a style hash → base36; stable across runs, good enough for cache names. */
export function stableHash(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function gatewayFileUrl(
  config: Pick<GatewayConfig, "url">,
  path: string,
  profile?: string | null,
  sessionId?: string | null,
): string {
  const params = [`path=${encodeURIComponent(path)}`];
  if (profile) params.push(`profile=${encodeURIComponent(profile)}`);
  if (sessionId) params.push(`session_id=${encodeURIComponent(sessionId)}`);
  return `${normalizeGatewayUrl(config.url)}/api/fs/download?${params.join("&")}`;
}

export function fileRequest(ref: FileRef | null, config: GatewayConfig | null): FileRequest | null {
  if (!ref) return null;
  if (ref.url !== undefined) {
    if (!/^https?:\/\//i.test(ref.url)) return null;
    const ext = extensionOf(ref.url);
    return {
      url: ref.url,
      headers: {},
      cacheName: `${stableHash(`url|${ref.url}`)}${ext ? `.${ext}` : ""}`,
      name: fileNameOf(ref.url),
      kind: kindOf(ref.url),
      authenticated: false,
      cookieAuth: false,
    };
  }
  if (!config || !ref.path || ref.path.includes("\0")) return null;
  const ext = extensionOf(ref.path);
  return {
    url: gatewayFileUrl(config, ref.path, ref.profile, ref.sessionId),
    headers: authHeaders(config),
    // Keyed by gateway + profile + path (not session): the same file seen from two chats shares one copy.
    cacheName: `${stableHash(`${normalizeGatewayUrl(config.url)}|${ref.profile ?? ""}|${ref.path}`)}${ext ? `.${ext}` : ""}`,
    name: fileNameOf(ref.path),
    kind: kindOf(ref.path),
    authenticated: true,
    cookieAuth: config.auth === "password",
  };
}

/** Readable message for a failed download (native errors carry the HTTP status in the text). */
export function downloadErrorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/\b401\b|\b403\b/.test(message)) return "Hermes refused access to this file (sensitive file or expired token).";
  if (/\b404\b/.test(message)) return "The file no longer exists on the Hermes machine.";
  if (/\b413\b/.test(message)) return "The file is too large to open.";
  if (/\b400\b/.test(message)) return "Hermes could not read this path.";
  return message || "Could not download the file.";
}
