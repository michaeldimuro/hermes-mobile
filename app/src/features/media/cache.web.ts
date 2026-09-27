/**
 * Web counterpart of cache.ts: expo-file-system is native-only, so files are fetched into Blob object
 * URLs held for the page lifetime. Browser media elements can't send custom headers, so audio/video
 * also go through a full download here (`streamsWithHeaders = false`).
 */
import type { FileRequest } from "./source";

export type LocalFile = { uri: string; size: number | null };

const done = new Map<string, LocalFile>();
const inflight = new Map<string, Promise<LocalFile>>();

async function download(request: FileRequest): Promise<LocalFile> {
  const response = await fetch(request.url, {
    headers: request.headers,
    credentials: request.cookieAuth ? "include" : "omit",
  });
  if (!response.ok) throw new Error(`Download failed with status ${response.status}`);
  const blob = await response.blob();
  const local = { uri: URL.createObjectURL(blob), size: blob.size };
  const previous = done.get(request.cacheName);
  if (previous) URL.revokeObjectURL(previous.uri);
  done.set(request.cacheName, local);
  return local;
}

export function fetchToLocal(request: FileRequest, options: { force?: boolean } = {}): Promise<LocalFile> {
  const key = request.cacheName;
  const cached = done.get(key);
  if (cached && !options.force) return Promise.resolve(cached);
  const pending = inflight.get(key);
  if (pending && !options.force) return pending;
  const promise = download(request).finally(() => {
    if (inflight.get(key) === promise) inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
}

export function peekLocal(request: FileRequest): LocalFile | null {
  return done.get(request.cacheName) ?? null;
}

export async function readLocalText(uri: string, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  const blob = await (await fetch(uri)).blob();
  const text = await blob.slice(0, maxBytes).text();
  return { text, truncated: blob.size > maxBytes };
}

/** No share sheet on web: hand the blob to the browser (opens/downloads in a new tab). */
export async function shareLocal(uri: string, _mimeType: string, title: string): Promise<void> {
  const link = document.createElement("a");
  link.href = uri;
  link.download = title;
  link.target = "_blank";
  link.rel = "noopener";
  link.click();
}

export const streamsWithHeaders = false;
