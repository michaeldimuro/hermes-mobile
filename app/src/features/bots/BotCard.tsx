import React, { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ProfileRow } from "@/lib/gateway/types";
import { BotAvatar, haptic, Icon } from "@/ui/primitives";
import { botColor, makeStyles, radius, space, useTheme } from "@/ui/theme";
import { botRole, botTitle } from "./format";

type Props = {
  bot: ProfileRow;
  active: boolean;
  onOpen: (name: string) => void;
  onChat: (name: string) => void;
};

function BotCardBase({ bot, active, onOpen, onChat }: Props) {
  const { colors } = useTheme();
  const styles = useStyles();
  const tint = botColor(bot.name, colors);
  const title = botTitle(bot);
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}. ${botRole(bot)}`}
        accessibilityHint="Opens bot settings"
        onPress={() => {
          haptic.tap();
          onOpen(bot.name);
        }}
        style={({ pressed }) => [
          styles.card,
          active && { borderColor: `${tint}66` },
          pressed && styles.pressed,
        ]}
      >
        <View style={styles.top}>
          <BotAvatar name={bot.name} size={48} ring={active} />
          <View style={styles.titleBlock}>
            <View style={styles.titleRow}>
              <Text numberOfLines={1} style={styles.title}>
                {title}
              </Text>
              {bot.is_default ? (
                <Text style={styles.badge}>DEFAULT</Text>
              ) : null}
            </View>
            <View style={styles.titleRow}>
              <Text numberOfLines={1} style={styles.handle}>
                @{bot.name}
              </Text>
              {active ? (
                <View style={styles.activePill}>
                  <View
                    style={[
                      styles.activeDot,
                      { backgroundColor: colors.success },
                    ]}
                  />
                  <Text style={styles.activeText}>Active</Text>
                </View>
              ) : null}
            </View>
          </View>
          {/* Room for the Chat button, which sits beside (not inside) this card button. */}
          <View style={styles.chatSlot} />
        </View>

        <Text
          numberOfLines={2}
          style={[styles.role, !bot.description && { color: colors.faint }]}
        >
          {botRole(bot)}
        </Text>

        <View style={styles.meta}>
          <View style={styles.metaChip}>
            <Icon name="hardware-chip-outline" size={13} color={tint} />
            <Text numberOfLines={1} style={styles.metaText}>
              {bot.model
                ? `${bot.provider ? `${bot.provider} · ` : ""}${bot.model}`
                : "Default model"}
            </Text>
          </View>
          {typeof bot.skill_count === "number" ? (
            <View style={[styles.metaChip, styles.metaFixed]}>
              <Icon name="sparkles-outline" size={13} color={colors.muted} />
              <Text style={styles.metaText}>
                {bot.skill_count} {bot.skill_count === 1 ? "skill" : "skills"}
              </Text>
            </View>
          ) : null}
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Chat with ${title}`}
        hitSlop={8}
        onPress={() => {
          haptic.press();
          onChat(bot.name);
        }}
        style={({ pressed }) => [
          styles.chat,
          styles.chatFloat,
          active && { backgroundColor: colors.accent },
          pressed && { opacity: 0.7 },
        ]}
      >
        <Icon
          name="chatbubble-ellipses"
          size={16}
          color={active ? colors.accentInk : colors.primaryInk}
        />
        <Text style={[styles.chatText, active && { color: colors.accentInk }]}>
          Chat
        </Text>
      </Pressable>
    </View>
  );
}

export const BotCard = memo(BotCardBase);

const useStyles = makeStyles((colors, type) => ({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: space.lg,
    gap: space.md,
  },
  pressed: { backgroundColor: colors.raised, transform: [{ scale: 0.99 }] },
  top: { flexDirection: "row", alignItems: "center", gap: space.md },
  titleBlock: { flex: 1, minWidth: 0, gap: 2 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  title: { ...type.heading, fontSize: 17, flexShrink: 1 },
  badge: { ...type.caption, fontSize: 10, color: colors.accentText },
  handle: { ...type.small, flexShrink: 1 },
  activePill: { flexDirection: "row", alignItems: "center", gap: 5 },
  activeDot: { width: 6, height: 6, borderRadius: 3 },
  activeText: { fontSize: 12, fontWeight: "600", color: colors.success },
  chat: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  // 48px avatar row centred: card padding + (48 - 36) / 2.
  chatFloat: { position: "absolute", top: space.lg + 6, right: space.lg },
  chatSlot: { width: 84, height: 36 },
  chatText: { fontSize: 14, fontWeight: "700", color: colors.primaryInk },
  role: { fontSize: 14, lineHeight: 20, color: colors.textSoft },
  meta: { flexDirection: "row", alignItems: "center", gap: space.sm },
  metaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    height: 26,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.raised,
    flexShrink: 1,
  },
  metaFixed: { flexShrink: 0 },
  metaText: {
    fontSize: 12,
    color: colors.muted,
    fontWeight: "500",
    flexShrink: 1,
  },
}));
