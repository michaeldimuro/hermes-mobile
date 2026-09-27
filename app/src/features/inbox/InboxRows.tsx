import React, { memo, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { BotAvatar, Icon } from "@/ui/primitives";
import { botColor, makeStyles, space, useTheme } from "@/ui/theme";
import { shortTime } from "./format";
import type { BotConversation } from "./grouping";
import type { Conversation } from "./useConversations";

export const CONVERSATION_AVATAR = 48;
export const STARTER_AVATAR = 40;

/** Wall clock that ticks once a minute, so relative times stay fresh without impure renders. */
export function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** iOS-style hairline that starts at the text column, not the screen edge. */
export function RowSeparator({ avatar }: { avatar: number }) {
  const styles = useStyles();
  return <View pointerEvents="none" style={[styles.separator, { left: space.lg + avatar + space.md }]} />;
}

/** 2×2 mosaic of member initials: a group's avatar. */
export function GroupAvatar({ members, size = CONVERSATION_AVATAR }: { members: string[]; size?: number }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const shown = members.slice(0, 4);
  const cell = size / 2;
  return (
    <View style={[styles.mosaic, { width: size, height: size, borderRadius: size / 2 }]}>
      {shown.map((name) => {
        const tint = botColor(name, colors);
        return (
          <View key={name} style={{ width: cell, height: cell, backgroundColor: `${tint}26`, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: tint, fontWeight: "700", fontSize: cell * 0.46 }}>{name.slice(0, 1).toUpperCase()}</Text>
          </View>
        );
      })}
    </View>
  );
}

export const ConversationRow = memo(function ConversationRow({
  item,
  now,
  separator,
  onPress,
  pinned,
  onLongPress,
}: {
  item: Conversation;
  now: number;
  separator: boolean;
  onPress: (item: Conversation) => void;
  pinned?: boolean;
  /** Long-press actions (pin / unpin). */
  onLongPress?: (item: Conversation) => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const group = item.kind === "group";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.title}${group ? ", group chat" : ""}. ${item.preview}`}
      onPress={() => onPress(item)}
      onLongPress={onLongPress ? () => onLongPress(item) : undefined}
      delayLongPress={350}
      accessibilityHint={onLongPress ? (pinned ? "Long-press to unpin" : "Long-press to pin to the top") : undefined}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.raised }]}
    >
      {group ? <GroupAvatar members={item.members} /> : <BotAvatar name={item.bot.name} size={CONVERSATION_AVATAR} />}
      <View style={styles.copy}>
        <View style={styles.line}>
          <Text style={styles.title} numberOfLines={1}>
            {item.title}
          </Text>
          {group ? (
            <Icon name={item.origin === "desktop" ? "desktop-outline" : "people-outline"} size={13} color={colors.faint} />
          ) : null}
          {pinned ? <Icon name="pin" size={13} color={colors.faint} /> : null}
          <Text style={styles.time}>{shortTime(item.at, now)}</Text>
        </View>
        <Text style={styles.preview} numberOfLines={2}>
          {group ? `${item.members.length} bots · ` : ""}
          {item.preview}
        </Text>
      </View>
      {separator ? <RowSeparator avatar={CONVERSATION_AVATAR} /> : null}
    </Pressable>
  );
});

/** Compact single-line row for a bot that has never been chatted with. */
export const StarterRow = memo(function StarterRow({
  item,
  separator,
  onPress,
}: {
  item: BotConversation;
  separator: boolean;
  onPress: (item: Conversation) => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const detail = item.bot.description?.trim() ?? "";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Start a conversation with ${item.title}${detail ? `. ${detail}` : ""}`}
      onPress={() => onPress(item)}
      style={({ pressed }) => [styles.row, styles.starter, pressed && { backgroundColor: colors.raised }]}
    >
      <BotAvatar name={item.bot.name} size={STARTER_AVATAR} />
      <View style={styles.starterCopy}>
        <Text style={styles.starterTitle} numberOfLines={1}>
          {item.title}
        </Text>
        {detail ? (
          <Text style={styles.starterDetail} numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
      {separator ? <RowSeparator avatar={STARTER_AVATAR} /> : null}
    </Pressable>
  );
});

export function SectionHeader({ title }: { title: string }) {
  const styles = useStyles();
  return (
    <Text accessibilityRole="header" style={styles.header}>
      {title}
    </Text>
  );
}

const useStyles = makeStyles((colors) => ({
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: 11 },
  copy: { flex: 1, minWidth: 0, gap: 3 },
  line: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { flexShrink: 1, color: colors.text, fontSize: 16, fontWeight: "600" },
  time: { marginLeft: "auto", color: colors.faint, fontSize: 13, fontVariant: ["tabular-nums"] },
  preview: { color: colors.muted, fontSize: 14, lineHeight: 19 },
  starter: { minHeight: 56, paddingVertical: 8 },
  starterCopy: { flex: 1, minWidth: 0, gap: 1 },
  starterTitle: { color: colors.text, fontSize: 16, lineHeight: 20, fontWeight: "600" },
  starterDetail: { color: colors.muted, fontSize: 13, lineHeight: 17 },
  header: { color: colors.muted, fontSize: 13, fontWeight: "600", paddingHorizontal: space.lg, paddingTop: space.xl, paddingBottom: 6 },
  separator: { position: "absolute", right: 0, bottom: 0, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  mosaic: { flexDirection: "row", flexWrap: "wrap", overflow: "hidden", backgroundColor: colors.raised },
}));
