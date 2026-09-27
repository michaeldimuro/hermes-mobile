import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import { botColor, lightColors } from "@/ui/theme";
import TurnActivity from "./TurnActivity";

type Instance = ReturnType<typeof TurnActivity.start>;
const UPDATE_EVERY_MS = 3000;

/**
 * Mirrors a running turn onto the Lock Screen / Dynamic Island (iOS Live Activity), so you can
 * leave the app while a bot works and see when it's done. Tapping it opens the chat (`url`).
 */
export function useTurnActivity({ running, status, bot, profile, url }: { running: boolean; status: string; bot: string; profile: string; url: string }) {
  const instance = useRef<Instance>(null);
  const lastUpdate = useRef(0);
  const color = botColor(profile, lightColors);

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    if (running && !instance.current) {
      try {
        instance.current = TurnActivity.start({ bot, status: "Working on it…", color }, url);
      } catch {
        instance.current = null; // Live Activities disabled or unsupported
      }
    }
    if (!running && instance.current) {
      const done = instance.current;
      instance.current = null;
      void done
        .end("default", { bot, status: AppState.currentState === "active" ? "Done" : "Reply ready. Tap to read", color, done: true })
        .catch(() => undefined);
    }
  }, [running, bot, color, url]);

  useEffect(() => {
    if (!instance.current || !status || Date.now() - lastUpdate.current < UPDATE_EVERY_MS) return;
    lastUpdate.current = Date.now();
    void instance.current.update({ bot, status: status.slice(0, 80), color }).catch(() => undefined);
  }, [status, bot, color]);

  // Leaving the chat ends the activity (this screen can no longer follow the turn to its end).
  const latest = useRef({ bot, color });
  useEffect(() => {
    latest.current = { bot, color };
  }, [bot, color]);
  useEffect(
    () => () => {
      const open = instance.current;
      instance.current = null;
      if (open) void open.end("default", { ...latest.current, status: "Still working. Open Hermes to follow" }).catch(() => undefined);
    },
    [],
  );
}
