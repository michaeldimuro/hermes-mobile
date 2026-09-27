import { Directory, File, Paths } from "expo-file-system";

/**
 * Small JSON snapshots kept on the phone (inbox lists, recent transcripts, pins) so the app opens
 * instantly and stays readable offline, then catches up from Hermes. Native: documents directory
 * (survives cache purges); web counterpart: offlineCache.web.ts (localStorage).
 */
const DIR = "hermes-offline";
const safe = (key: string) => key.replace(/[^a-z0-9._-]+/gi, "_").slice(0, 120);

function dir() {
  const folder = new Directory(Paths.document, DIR);
  if (!folder.exists) folder.create({ intermediates: true, idempotent: true });
  return folder;
}

export async function readCache<T>(key: string): Promise<T | null> {
  try {
    const file = new File(Paths.document, DIR, `${safe(key)}.json`);
    if (!file.exists) return null;
    return JSON.parse(await file.text()) as T;
  } catch {
    return null;
  }
}

export async function writeCache(key: string, value: unknown) {
  try {
    const file = new File(dir(), `${safe(key)}.json`);
    file.write(JSON.stringify(value));
  } catch {
    // Best effort: a failed snapshot only costs the next cold start a spinner.
  }
}

/** Forget everything (sign-out): cached chats must not outlive the connection that fetched them. */
export async function clearCache() {
  try {
    const folder = new Directory(Paths.document, DIR);
    if (folder.exists) folder.delete();
  } catch {
    // Nothing cached.
  }
}
