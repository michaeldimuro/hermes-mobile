/**
 * Native download cache (iOS/Android) on the SDK 57 `expo-file-system` File/Directory API.
 * Files land in `<cache>/hermes-media/<hash>.<ext>`; concurrent requests for the same file share one
 * download, and a cached copy younger than MAX_AGE_MS is reused (the gateway's fs route has no HEAD,
 * so mtime can't be checked cheaply — `force` re-downloads). Web counterpart: cache.web.ts.
 */
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import type { FileRequest } from "./source";

export type LocalFile = { uri: string; size: number | null };

const DIR_NAME = "hermes-media";
const MAX_AGE_MS = 12 * 60 * 60 * 1000;
const inflight = new Map<string, Promise<LocalFile>>();

function cacheDir() {
  const dir = new Directory(Paths.cache, DIR_NAME);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

function freshCopy(file: File): LocalFile | null {
  if (!file.exists || !file.size) return null;
  const modified = file.modificationTime;
  if (modified != null && Date.now() - modified > MAX_AGE_MS) return null;
  return { uri: file.uri, size: file.size };
}

async function download(request: FileRequest, force: boolean): Promise<LocalFile> {
  const target = new File(cacheDir(), request.cacheName);
  const cached = force ? null : freshCopy(target);
  if (cached) return cached;
  if (request.cookieAuth) {
    // Password backends: the session is a cookie that only RN `fetch` is guaranteed to carry.
    const response = await fetch(request.url, { credentials: "include", headers: request.headers });
    if (!response.ok) throw new Error(`Download failed with status ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (target.exists) target.delete();
    target.create({ intermediates: true });
    target.write(bytes);
    return { uri: target.uri, size: bytes.byteLength };
  }
  const file = await File.downloadFileAsync(request.url, target, { headers: request.headers, idempotent: true });
  return { uri: file.uri, size: file.size ?? null };
}

/** Download (or reuse) the file behind `request`; resolves to a local `file://` URI. */
export function fetchToLocal(request: FileRequest, options: { force?: boolean } = {}): Promise<LocalFile> {
  const key = request.cacheName;
  const pending = inflight.get(key);
  if (pending && !options.force) return pending;
  const promise = download(request, Boolean(options.force)).finally(() => {
    if (inflight.get(key) === promise) inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
}

/** Already on disk and fresh? (lets cards show cached thumbnails without waiting). */
export function peekLocal(request: FileRequest): LocalFile | null {
  try {
    return freshCopy(new File(Paths.cache, DIR_NAME, request.cacheName));
  } catch {
    return null;
  }
}

export async function readLocalText(uri: string, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  const file = new File(uri);
  const size = file.size ?? 0;
  if (size > maxBytes && typeof TextDecoder !== "undefined") {
    const handle = file.open();
    try {
      return { text: new TextDecoder().decode(handle.readBytes(maxBytes)), truncated: true };
    } finally {
      handle.close();
    }
  }
  const text = await file.text();
  return text.length > maxBytes ? { text: text.slice(0, maxBytes), truncated: true } : { text, truncated: false };
}

/** Hand a downloaded file to the OS share sheet ("Open in…", Save to Files, AirDrop…). */
export async function shareLocal(uri: string, mimeType: string, title: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing is not available on this device.");
  await Sharing.shareAsync(uri, { mimeType, dialogTitle: title });
}

/** Native players accept request headers, so token-auth audio/video stream straight from the gateway
 *  (Range supported). Cookie-auth (password) backends download first. */
export const streamsWithHeaders = true;
