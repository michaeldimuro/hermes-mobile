import { useEffect, useMemo, useState } from "react";
import { useGateway } from "@/lib/store/GatewayProvider";
import { fetchToLocal, peekLocal, streamsWithHeaders, type LocalFile } from "./cache";
import { kindOf, mimeOf, type MediaKind } from "./kinds";
import { downloadErrorText, fileRequest, type FileRef, type FileRequest } from "./source";

export type FileStatus = "idle" | "loading" | "ready" | "error";

export type FileState = {
  status: FileStatus;
  /** `file://` (native) or `blob:` (web) URI once downloaded. */
  localUri: string | null;
  mime: string;
  size: number | null;
  error: string | null;
  name: string;
  kind: MediaKind;
  /** Re-download (bypasses the cache). */
  retry: () => void;
};

/** Resolve a file reference against the connected gateway (memoised on the ref's primitive fields). */
export function useFileRequest(ref: FileRef | null): FileRequest | null {
  const { config } = useGateway();
  const path = ref?.path;
  const url = ref?.url;
  const profile = ref && ref.url === undefined ? ref.profile : undefined;
  const sessionId = ref && ref.url === undefined ? ref.sessionId : undefined;
  return useMemo(() => {
    if (url !== undefined) return fileRequest({ url }, config);
    if (path !== undefined) return fileRequest({ path, profile, sessionId }, config);
    return null;
  }, [config, path, url, profile, sessionId]);
}

type Result = { key: string; local?: LocalFile; error?: string };

/**
 * Download (or reuse from cache) a gateway/remote file. Pass `enabled: false` to defer the network
 * work (e.g. while a reply is still streaming) — a copy that is already cached is still returned.
 */
export function useFile(ref: FileRef | null, options: { enabled?: boolean } = {}): FileState {
  const enabled = options.enabled ?? true;
  const request = useFileRequest(ref);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const key = request ? `${request.cacheName}#${attempt}` : "";
  const cached = useMemo(() => (request && attempt === 0 ? peekLocal(request) : null), [request, attempt]);

  useEffect(() => {
    if (!request || !enabled || cached) return;
    let alive = true;
    fetchToLocal(request, { force: attempt > 0 }).then(
      (local) => alive && setResult({ key, local }),
      (error: unknown) => alive && setResult({ key, error: downloadErrorText(error) }),
    );
    return () => {
      alive = false;
    };
  }, [request, enabled, cached, attempt, key]);

  const name = request?.name ?? "";
  const target = ref?.path ?? ref?.url ?? "";
  const base = {
    name,
    kind: request?.kind ?? kindOf(target),
    mime: mimeOf(target),
    retry: () => setAttempt((value) => value + 1),
  };
  const current = result?.key === key ? result : null;
  const local = current?.local ?? cached;
  if (local) return { ...base, status: "ready", localUri: local.uri, size: local.size, error: null };
  if (current?.error) return { ...base, status: "error", localUri: null, size: null, error: current.error };
  if (!request)
    return {
      ...base,
      status: ref ? "error" : "idle",
      localUri: null,
      size: null,
      error: ref ? "Not connected to Hermes." : null,
    };
  return { ...base, status: enabled ? "loading" : "idle", localUri: null, size: null, error: null };
}

export type StreamSource = { uri: string; headers: Record<string, string> };

/**
 * Direct streaming source for native players (expo-video / expo-audio accept `headers`, and the
 * gateway route honours Range). Null on web and for cookie-auth backends — download with useFile.
 */
export function useStreamSource(ref: FileRef | null): StreamSource | null {
  const request = useFileRequest(ref);
  return useMemo(
    () => (request && streamsWithHeaders && !request.cookieAuth ? { uri: request.url, headers: request.headers } : null),
    [request],
  );
}

const sizes = new Map<string, Promise<number | null>>();

/** Total size via a 1-byte Range request (the gateway route has no HEAD); cached per URL. */
export function probeSize(request: FileRequest): Promise<number | null> {
  const existing = sizes.get(request.url);
  if (existing) return existing;
  const promise = fetch(request.url, {
    headers: { ...request.headers, Range: "bytes=0-0" },
    credentials: request.cookieAuth ? "include" : "omit",
  })
    .then((response) => {
      if (!response.ok) return null;
      const total = /\/(\d+)\s*$/.exec(response.headers.get("content-range") ?? "")?.[1];
      const length = response.status === 200 ? response.headers.get("content-length") : null;
      const value = Number(total ?? length);
      return Number.isFinite(value) && value > 0 ? value : null;
    })
    .catch(() => null);
  sizes.set(request.url, promise);
  return promise;
}

/** Lazily probed file size for attachment cards; null until known (or when disabled). */
export function useRemoteSize(request: FileRequest | null, enabled: boolean): number | null {
  const [known, setKnown] = useState<{ url: string; size: number | null } | null>(null);
  useEffect(() => {
    if (!request || !enabled) return;
    let alive = true;
    probeSize(request).then((size) => alive && setKnown({ url: request.url, size }));
    return () => {
      alive = false;
    };
  }, [request, enabled]);
  return known && request && known.url === request.url ? known.size : null;
}
