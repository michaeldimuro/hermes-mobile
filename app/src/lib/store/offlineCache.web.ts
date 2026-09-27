/** Web: localStorage snapshots (see offlineCache.ts). Quota errors just skip the write. */
const PREFIX = "hermes-offline:";

export async function readCache<T>(key: string): Promise<T | null> {
  try {
    const raw = globalThis.localStorage?.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function writeCache(key: string, value: unknown) {
  try {
    globalThis.localStorage?.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Over quota or storage blocked.
  }
}

export async function clearCache() {
  try {
    const store = globalThis.localStorage;
    if (!store) return;
    for (const key of Object.keys(store)) if (key.startsWith(PREFIX)) store.removeItem(key);
  } catch {
    // Storage blocked.
  }
}
