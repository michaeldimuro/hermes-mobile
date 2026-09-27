import { useEffect } from "react";
import { Platform } from "react-native";
import * as QuickActions from "expo-quick-actions";
import { useQuickActionRouting } from "expo-quick-actions/router";
import { botTitle } from "@/features/chat/botMeta";
import { useGateway } from "@/lib/store/GatewayProvider";
import { usePins } from "@/lib/store/pins";
import { botColor, lightColors } from "@/ui/theme";
import HermesBotsWidget from "@/widgets/HermesBotsWidget";
import { useNotificationRouting } from "@/features/push/usePush";

/**
 * Keeps the app's presence outside itself current: home-screen quick actions (long-press the icon)
 * and the iOS "Hermes Bots" widget list your pinned bots first, then the busiest ones.
 */
export function DeviceShortcuts() {
  const { profiles } = useGateway();
  const pins = usePins();
  useQuickActionRouting();
  useNotificationRouting();

  const ranked = [...profiles].sort((a, b) => {
    const pa = pins.indexOf(`bot:${a.name}`);
    const pb = pins.indexOf(`bot:${b.name}`);
    if (pa !== pb) return (pa < 0 ? Infinity : pa) - (pb < 0 ? Infinity : pb);
    return Number(b.canonical_session?.message_count ?? 0) - Number(a.canonical_session?.message_count ?? 0);
  });
  const signature = ranked.map((p) => `${p.name}:${botTitle(p, p.name)}`).join("|");

  useEffect(() => {
    if (Platform.OS === "web" || !signature) return;
    const bots = signature.split("|").map((entry) => {
      const [name, title] = [entry.slice(0, entry.indexOf(":")), entry.slice(entry.indexOf(":") + 1)];
      return { name, title };
    });
    void QuickActions.setItems([
      { id: "new", title: "New chat", icon: Platform.OS === "ios" ? "symbol:square.and.pencil" : undefined, params: { href: "/new" } },
      ...bots.slice(0, 2).map((bot) => ({
        id: `bot-${bot.name}`,
        title: bot.title,
        subtitle: "Open conversation",
        icon: Platform.OS === "ios" ? "symbol:bubble.left.and.bubble.right" : undefined,
        params: { href: `/bot/${encodeURIComponent(bot.name)}` },
      })),
      { id: "boards", title: "Boards", icon: Platform.OS === "ios" ? "symbol:rectangle.3.group" : undefined, params: { href: "/boards" } },
    ]).catch(() => undefined);
    if (Platform.OS === "ios")
      HermesBotsWidget.updateSnapshot({
        bots: bots.slice(0, 4).map((bot) => ({
          name: bot.name,
          title: bot.title.split(" ")[0],
          initial: bot.name === "default" ? "H" : bot.title.slice(0, 1).toUpperCase(),
          color: botColor(bot.name, lightColors),
        })),
      });
  }, [signature]);

  return null;
}
