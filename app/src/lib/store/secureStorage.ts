import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

/**
 * Keychain / Keystore on iOS and Android. expo-secure-store has no web implementation, so the web
 * build falls back to localStorage (browser-profile scoped, not hardware-backed).
 */
const web = Platform.OS === "web";

export const secureStorage = {
  get: (key: string): Promise<string | null> =>
    web ? Promise.resolve(globalThis.localStorage?.getItem(key) ?? null) : SecureStore.getItemAsync(key),
  set: (key: string, value: string): Promise<void> =>
    web ? Promise.resolve(globalThis.localStorage?.setItem(key, value)) : SecureStore.setItemAsync(key, value),
  remove: (key: string): Promise<void> =>
    web ? Promise.resolve(globalThis.localStorage?.removeItem(key)) : SecureStore.deleteItemAsync(key),
};
