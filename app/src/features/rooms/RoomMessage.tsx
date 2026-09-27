import React, { memo } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { RichMessage } from "@/features/media/RichMessage";
import { BotAvatar, haptic } from "@/ui/primitives";
import { botColor, makeStyles, radius, space, useTheme } from "@/ui/theme";
import type { DisplayName } from "./RoomBits";
import type { MirrorEntry, TimelineRow } from "./roomMirror";

const AVATAR = 28;

export const formatClock = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** One row of a read-only desktop group chat: day/thread separator, user bubble or bot reply. */
export const RoomRow = memo(function RoomRow({
  row,
  displayName,
  onReply,
}: {
  row: TimelineRow;
  displayName?: DisplayName;
  /** Long-press → reply to this message (quoted, its author addressed). */
  onReply?: (entry: MirrorEntry, text: string) => void;
}) {
  const styles = useStyles();
  const markdownStyles = useMarkdownStyles();
  const { colors } = useTheme();

  if (row.type === "day") {
    return (
      <View style={styles.separator} accessibilityRole="header">
        <Text style={styles.dayText}>{row.label}</Text>
      </View>
    );
  }
  if (row.type === "thread") {
    return (
      <View style={styles.threadRow} accessibilityLabel="New thread">
        <View style={styles.threadLine} />
        <Text style={styles.threadText}>New thread</Text>
        <View style={styles.threadLine} />
      </View>
    );
  }

  const { entry } = row;
  const menu = () => {
    haptic.press();
    Alert.alert("Message", undefined, [
      ...(onReply ? [{ text: "Reply", onPress: () => onReply(entry, row.text) }] : []),
      { text: "Copy", onPress: () => void Clipboard.setStringAsync(row.text).then(() => haptic.success()) },
      { text: "Cancel", style: "cancel" as const },
    ]);
  };
  const time = row.last ? formatClock(entry.at) : null;
  const loading = row.status === "loading" ? (
    <View style={styles.loadingRow}>
      <ActivityIndicator size="small" color={colors.muted} />
      <Text style={styles.loadingText}>Loading full message…</Text>
    </View>
  ) : null;

  if (entry.from.kind === "user") {
    return (
      <Pressable onLongPress={menu} delayLongPress={350} style={[styles.userRow, row.first && styles.groupStart]}>
        <View style={[styles.userBubble, !row.first && styles.userBubbleCont, !row.last && styles.userBubbleMid]}>
          <Text style={styles.userText}>
            {row.text}
          </Text>
          {loading}
        </View>
        {time ? <Text style={[styles.time, styles.timeRight]}>{time}</Text> : null}
      </Pressable>
    );
  }

  const tint = botColor(entry.from.name, colors);
  const label = displayName?.(entry.from.name) ?? entry.from.name;
  return (
    <Pressable onLongPress={menu} delayLongPress={350} style={[styles.botRow, row.first && styles.groupStart]} accessibilityHint="Long-press to reply or copy">
      <View style={styles.avatarCol}>{row.first ? <BotAvatar name={entry.from.name} size={AVATAR} /> : null}</View>
      <View style={styles.botBody}>
        {row.first ? (
          <Text style={[styles.botName, { color: tint }]} numberOfLines={1}>
            {label}
            {entry.from.source && entry.from.source !== "This device" ? <Text style={styles.source}>{`  ·  ${entry.from.source}`}</Text> : null}
          </Text>
        ) : null}
        <View style={[styles.botBubble, !row.first && styles.botBubbleCont, { borderLeftColor: `${tint}66` }]}>
          {/* Files a bot shares live on its own profile; room sessions are per member, so no session scope. */}
          <RichMessage text={row.text} profile={entry.from.name} markdownStyle={markdownStyles} />
          {loading}
        </View>
        {time ? <Text style={styles.time}>{time}</Text> : null}
      </View>
    </Pressable>
  );
});

const useMarkdownStyles = makeStyles((colors, type) => ({
  body: { ...type.body, fontSize: 15, lineHeight: 22 },
  paragraph: { marginTop: 0, marginBottom: space.sm },
  heading1: { ...type.title, marginVertical: space.sm },
  heading2: { ...type.heading, fontSize: 17, marginVertical: space.sm },
  heading3: { ...type.heading, marginVertical: space.xs },
  strong: { fontWeight: "700", color: colors.text },
  em: { fontStyle: "italic" },
  link: { color: colors.accentText, textDecorationLine: "underline" },
  bullet_list: { marginBottom: space.sm },
  ordered_list: { marginBottom: space.sm },
  list_item: { marginBottom: 2 },
  blockquote: {
    backgroundColor: colors.raised,
    borderLeftWidth: 3,
    borderLeftColor: colors.borderStrong,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    marginBottom: space.sm,
  },
  code_inline: { ...type.mono, backgroundColor: colors.overlay, color: colors.textSoft, borderRadius: 6, paddingHorizontal: 4 },
  fence: {
    ...type.mono,
    backgroundColor: colors.bg,
    color: colors.textSoft,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    padding: space.md,
    marginBottom: space.sm,
  },
  code_block: { ...type.mono, backgroundColor: colors.bg, color: colors.textSoft, borderRadius: radius.sm, padding: space.md },
  table: { borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, marginBottom: space.sm },
  th: { padding: space.sm, borderColor: colors.border },
  td: { padding: space.sm, borderColor: colors.border },
  tr: { borderColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
  hr: { backgroundColor: colors.border, height: StyleSheet.hairlineWidth, marginVertical: space.md },
}));

const useStyles = makeStyles((colors, type) => ({
  separator: { alignItems: "center", marginTop: space.xl, marginBottom: space.xs },
  dayText: {
    ...type.caption,
    color: colors.muted,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    overflow: "hidden",
    paddingHorizontal: space.md,
    paddingVertical: 4,
  },
  threadRow: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.xl, marginTop: space.lg },
  threadLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  threadText: { ...type.caption, color: colors.faint },
  groupStart: { marginTop: space.md },
  userRow: { alignItems: "flex-end", paddingLeft: space.xxl + space.lg, paddingRight: space.lg, marginTop: 3 },
  userBubble: {
    maxWidth: "100%",
    backgroundColor: colors.userBubble,
    borderRadius: radius.lg,
    borderBottomRightRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    paddingHorizontal: space.lg,
    paddingVertical: 10,
  },
  userBubbleCont: { borderTopRightRadius: 6 },
  userBubbleMid: { borderBottomRightRadius: 6 },
  userText: { ...type.body, fontSize: 15, lineHeight: 22 },
  botRow: { flexDirection: "row", alignItems: "flex-start", paddingLeft: space.md, paddingRight: space.xl, marginTop: 3 },
  avatarCol: { width: AVATAR, marginRight: space.sm, paddingTop: 2 },
  botBody: { flex: 1, minWidth: 0 },
  botName: { fontSize: 13, fontWeight: "700", marginBottom: 4, marginLeft: 2 },
  source: { color: colors.faint, fontWeight: "500" },
  botBubble: {
    alignSelf: "flex-start",
    maxWidth: "100%",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderTopLeftRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderLeftWidth: 2,
    paddingHorizontal: space.md + 2,
    paddingTop: 10,
    paddingBottom: 2,
  },
  botBubbleCont: { borderTopLeftRadius: radius.lg },
  time: { ...type.small, fontSize: 11, color: colors.faint, marginTop: 4, marginLeft: 4 },
  timeRight: { marginLeft: 0, marginRight: 4 },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: space.xs, marginTop: 2, marginBottom: space.sm },
  loadingText: { ...type.small, fontSize: 12 },
}));
