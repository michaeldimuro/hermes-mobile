import { useCallback, useEffect, useState } from "react";
import { AppState, Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Href, router } from "expo-router";
import { errorText, useGateway } from "@/lib/store/GatewayProvider";
import { secureStorage } from "@/lib/store/secureStorage";
import { writePushDevice } from "./pushRegistry";

const TOKEN_KEY = "hermes.pushToken";

if (Platform.OS !== "web")
  Notifications.setNotificationHandler({
    // While the app is open the chat itself shows the reply; banners are for when you're elsewhere.
    handleNotification: async () => {
      const away = AppState.currentState !== "active";
      return { shouldPlaySound: away, shouldSetBadge: false, shouldShowBanner: away, shouldShowList: true };
    },
  });

export const easProjectId = () =>
  (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId ?? Constants.easConfig?.projectId ?? null;

/** Tapping a notification opens what it's about (the relay puts an in-app path in `data.url`). */
export function useNotificationRouting() {
  useEffect(() => {
    if (Platform.OS === "web") return;
    const open = (notification: Notifications.Notification) => {
      const url = notification.request.content.data?.url;
      if (typeof url === "string" && url.startsWith("/")) router.push(url as Href);
    };
    const last = Notifications.getLastNotificationResponse();
    if (last?.notification) open(last.notification);
    const sub = Notifications.addNotificationResponseReceivedListener((response) => open(response.notification));
    return () => sub.remove();
  }, []);
}

/** Notification on/off for this phone: permission, Expo push token, and registration with Hermes. */
export function usePush() {
  const { call, showToast } = useGateway();
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void secureStorage.get(TOKEN_KEY).then(setToken);
  }, []);

  const enable = useCallback(async () => {
    const projectId = easProjectId();
    if (!projectId) {
      showToast("Push needs an EAS project: run `npx eas-cli@latest init` in the app, then rebuild.", "warn");
      return false;
    }
    if (!Device.isDevice) {
      showToast("Push notifications need a real phone.", "warn");
      return false;
    }
    setBusy(true);
    try {
      if (Platform.OS === "android")
        await Notifications.setNotificationChannelAsync("default", { name: "Bot replies", importance: Notifications.AndroidImportance.HIGH });
      let { status } = await Notifications.getPermissionsAsync();
      if (status !== "granted") status = (await Notifications.requestPermissionsAsync()).status;
      if (status !== "granted") {
        showToast("Allow notifications for Hermes in Settings.", "warn");
        return false;
      }
      const next = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
      await writePushDevice(call, next, { token: next, name: Device.deviceName ?? "Phone", at: Date.now() });
      await secureStorage.set(TOKEN_KEY, next);
      setToken(next);
      return true;
    } catch (error) {
      showToast(errorText(error, "Couldn't turn on notifications"), "error");
      return false;
    } finally {
      setBusy(false);
    }
  }, [call, showToast]);

  const disable = useCallback(async () => {
    if (!token) return;
    setBusy(true);
    try {
      await writePushDevice(call, token, null);
      await secureStorage.remove(TOKEN_KEY);
      setToken(null);
    } catch (error) {
      showToast(errorText(error, "Couldn't turn off notifications"), "error");
    } finally {
      setBusy(false);
    }
  }, [call, showToast, token]);

  return { enabled: Boolean(token), busy, enable, disable };
}
