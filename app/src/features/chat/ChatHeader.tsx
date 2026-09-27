import React from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ConnectionBanner } from "@/features/shell/ConnectionBanner";
import { BotAvatar, haptic, Icon, IconButton } from "@/ui/primitives";
import { makeStyles, radius, space, useTheme } from "@/ui/theme";

type Props = {
  botName: string;
  botId: string;
  subtitle: string;
  running: boolean;
  contextPercent?: number | null;
  onBack: () => void;
  onSwitchBot: () => void;
  onNewChat: () => void;
  onSettings?: () => void;
};

export function ChatHeader(props: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const context = Math.round(Math.min(100, Math.max(0, props.contextPercent ?? 0)));
  return (
    <View style={[styles.wrap, { paddingTop: insets.top + space.xs }]}>
      <View style={styles.bar}>
        <IconButton icon="chevron-back" label="Back to chats" size={26} onPress={props.onBack} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Talking to ${props.botName}. Switch bot`}
          onPress={() => {
            haptic.tap();
            props.onSwitchBot();
          }}
          style={({ pressed }) => [styles.pill, pressed && { backgroundColor: colors.raised }]}
        >
          <BotAvatar name={props.botId} size={24} />
          <View style={{ flexShrink: 1 }}>
            <Text style={styles.name} numberOfLines={1}>
              {props.botName}
            </Text>
            <Text style={styles.sub} numberOfLines={1}>
              {props.running ? "working…" : props.subtitle}
            </Text>
          </View>
          <Icon name="chevron-down" size={14} color={colors.muted} />
        </Pressable>
        <View style={styles.right}>
          {props.onSettings ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Chat settings${context >= 50 ? `, context ${context}% full` : ""}`}
              onPress={props.onSettings}
              hitSlop={6}
              style={({ pressed }) => [styles.more, pressed && { opacity: 0.6 }]}
            >
              {/* The context meter only earns space once it matters. */}
              {context >= 50 ? (
                <Text style={[styles.context, context > 80 && { color: colors.warn }]}>{context}%</Text>
              ) : null}
              <Icon name="ellipsis-horizontal" size={22} color={colors.text} />
            </Pressable>
          ) : null}
          <IconButton icon="create-outline" label="New chat" size={22} onPress={props.onNewChat} />
        </View>
      </View>
      <ConnectionBanner />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: { backgroundColor: colors.bg, paddingHorizontal: space.xs },
  bar: { flexDirection: "row", alignItems: "center", height: 52 },
  pill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    justifyContent: "center",
    gap: space.sm,
    marginHorizontal: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  name: { color: colors.text, fontSize: 16, fontWeight: "600" },
  sub: { color: colors.muted, fontSize: 11 },
  right: { flexDirection: "row", alignItems: "center" },
  more: { flexDirection: "row", alignItems: "center", gap: 4, height: 40, minWidth: 40, paddingHorizontal: 6, justifyContent: "center" },
  context: { color: colors.muted, fontSize: 12, fontWeight: "600", fontVariant: ["tabular-nums"] },
}));
