import { useSyncExternalStore } from "react";
import { Platform } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import { secureStorage } from "./secureStorage";

/**
 * Face ID / Touch ID / device-passcode lock for the app (the phone can run commands on your Mac
 * through your bots). The preference lives in the keychain; the lock engages on launch and after
 * the app has been in the background for LOCK_AFTER_MS.
 */
const KEY = "hermes.appLock";
export const LOCK_AFTER_MS = 30_000;

type LockState = { enabled: boolean; locked: boolean; ready: boolean };
let state: LockState = { enabled: false, locked: false, ready: Platform.OS === "web" };
const listeners = new Set<() => void>();
const set = (next: Partial<LockState>) => {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
};

if (Platform.OS !== "web")
  void secureStorage
    .get(KEY)
    .then((value) => set({ enabled: value === "on", locked: value === "on", ready: true }))
    .catch(() => set({ ready: true }));

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const snapshot = () => state;

export function useAppLock() {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Whether this device can lock the app (biometrics or a passcode enrolled). */
export async function lockAvailable() {
  if (Platform.OS === "web") return false;
  const [hardware, enrolled, level] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
    LocalAuthentication.getEnrolledLevelAsync(),
  ]);
  return (hardware && enrolled) || level !== LocalAuthentication.SecurityLevel.NONE;
}

export async function unlock() {
  const result = await LocalAuthentication.authenticateAsync({ promptMessage: "Unlock Hermes" });
  if (result.success) set({ locked: false });
  return result.success;
}

export function lockNow() {
  if (state.enabled) set({ locked: true });
}

/** Turning the lock on requires a successful authentication first (proves the user can get back in). */
export async function setLockEnabled(on: boolean) {
  if (on) {
    const result = await LocalAuthentication.authenticateAsync({ promptMessage: "Turn on app lock" });
    if (!result.success) return false;
  }
  await secureStorage.set(KEY, on ? "on" : "off");
  set({ enabled: on, locked: false });
  return true;
}
