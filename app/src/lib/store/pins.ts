import { useSyncExternalStore } from "react";
import { readCache, writeCache } from "./offlineCache";

/**
 * Conversations (bots, group chats) pinned to the top of the inbox on this phone. Hermes has no
 * pin flag for a bot or a desktop room, so these live on the device; session pins use Hermes's own
 * `pinned` flag instead and sync everywhere.
 */
let pins: readonly string[] = [];
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

function load() {
  if (loaded) return;
  loaded = true;
  void readCache<string[]>("pins").then((saved) => {
    if (Array.isArray(saved) && saved.length && !pins.length) {
      pins = saved;
      emit();
    }
  });
}

export const isPinned = (key: string) => pins.includes(key);

export function togglePin(key: string) {
  pins = pins.includes(key) ? pins.filter((k) => k !== key) : [key, ...pins];
  void writeCache("pins", pins);
  emit();
}

const subscribe = (listener: () => void) => {
  load();
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const snapshot = () => pins;

/** Pinned conversation keys, most recently pinned first. */
export function usePins() {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
