import React, { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BotAvatar, haptic, Icon, IconButton } from "@/ui/primitives";
import { botColor, makeStyles, radius, space, useTheme } from "@/ui/theme";
import type { MirrorMember } from "./roomMirror";

export type ThreadInfo = { id: string; at: number } | null;
type Label = (profile: string) => string;

/** The thread of the room's newest message (the default "reply in thread" target). */
export function latestThreadOf(log: { thread?: string; at: number }[] | undefined): ThreadInfo {
  const entry = [...(log ?? [])].reverse().find((e) => e.thread);
  return entry?.thread ? { id: entry.thread, at: entry.at } : null;
}

export function relativeTime(at: number, now: number) {
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** "CFO is replying…" with the member's avatar, or the latest runner note. */
export function RoomProgress({ member, round, note, displayName }: { member?: string; round?: number; note?: string; displayName: Label }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const text = member ? `${displayName(member)} is replying…${round && round > 1 ? ` (round ${round})` : ""}` : (note ?? "Working…");
  return (
    <View style={styles.progress} accessibilityLiveRegion="polite" accessibilityLabel={text}>
      {member ? <BotAvatar name={member} size={22} ring /> : <ActivityIndicator size="small" color={colors.muted} />}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.progressText, member ? { color: botColor(member, colors) } : null]} numberOfLines={1}>
          {text}
        </Text>
        {member && note ? (
          <Text style={styles.progressNote} numberOfLines={1}>
            {note}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** Multiline composer with @-mention chips, a thread toggle and send/stop. */
export function RoomComposer({
  members,
  displayName,
  tagFor,
  latestThread,
  newTopic,
  onToggleNewTopic,
  busy,
  onSend,
  onStop,
  now,
  replyTo,
}: {
  members: MirrorMember[];
  displayName: Label;
  tagFor: (profile: string) => string;
  latestThread: ThreadInfo;
  newTopic: boolean;
  onToggleNewTopic: () => void;
  busy: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  now: number;
  replyTo?: { label: string; onCancel: () => void } | null;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState("");
  const [picker, setPicker] = useState(false);
  const partial = /(^|\s)@([\w.-]*)$/.exec(text);
  const showPicker = picker || Boolean(partial);
  const query = (partial?.[2] ?? "").toLowerCase();
  const options = [
    { key: "everyone", tag: "everyone", label: "Everyone" },
    ...members.map((m) => ({ key: m.name, tag: tagFor(m.name), label: displayName(m.name) })),
  ].filter((o) => !query || o.tag.toLowerCase().startsWith(query) || o.label.toLowerCase().startsWith(query));

  const insert = (tag: string) => {
    haptic.tap();
    setText((current) => {
      const base = /(^|\s)@[\w.-]*$/.test(current) ? current.replace(/@[\w.-]*$/, "") : current && !/\s$/.test(current) ? `${current} ` : current;
      return `${base}@${tag} `;
    });
    setPicker(false);
  };

  const submit = () => {
    const body = text.trim();
    if (!body || busy) return;
    haptic.press();
    setText("");
    setPicker(false);
    onSend(body);
  };

  const replying = latestThread && !newTopic;
  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, space.sm) }]}>
      {replyTo ? (
        <View style={styles.replyBanner}>
          <Icon name="arrow-undo-outline" size={15} color={colors.accentText} />
          <Text style={styles.replyText} numberOfLines={1}>
            {replyTo.label}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel reply" hitSlop={10} onPress={replyTo.onCancel}>
            <Icon name="close" size={16} color={colors.muted} />
          </Pressable>
        </View>
      ) : null}
      {showPicker && options.length ? (
        <ScrollView horizontal keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {options.map((o) => (
            <Pressable
              key={o.key}
              accessibilityRole="button"
              accessibilityLabel={`Mention ${o.label}`}
              onPress={() => insert(o.tag)}
              style={({ pressed }) => [styles.chip, pressed && { opacity: 0.7 }]}
            >
              {o.key === "everyone" ? <Icon name="people" size={16} color={colors.textSoft} /> : <BotAvatar name={o.key} size={20} />}
              <Text style={styles.chipText}>@{o.tag}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      <View style={styles.threadRow}>
        {latestThread ? (
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: !newTopic }}
            accessibilityLabel={replying ? "Replying in the latest thread. Tap to start a new topic" : "New topic. Tap to reply in the latest thread"}
            onPress={() => {
              haptic.tap();
              onToggleNewTopic();
            }}
            style={({ pressed }) => [styles.threadChip, !replying && styles.threadChipNew, pressed && { opacity: 0.7 }]}
          >
            <Icon name={replying ? "return-down-forward" : "add-circle-outline"} size={14} color={replying ? colors.textSoft : colors.accentText} />
            <Text style={[styles.threadText, !replying && { color: colors.accentText }]} numberOfLines={1}>
              {replying ? `Replying in thread · ${relativeTime(latestThread.at, now)}` : "New topic"}
            </Text>
            <Text style={styles.threadSwitch}>{replying ? "New topic" : "Reply in thread"}</Text>
          </Pressable>
        ) : (
          <Text style={styles.threadText}>New topic</Text>
        )}
      </View>
      <View style={styles.inputRow}>
        <IconButton icon="at" label="Mention a bot" onPress={() => setPicker((v) => !v)} color={showPicker ? colors.accentText : colors.muted} />
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={replying ? "Reply to the group" : "Message the group"}
          placeholderTextColor={colors.faint}
          multiline
          style={styles.input}
          accessibilityLabel="Message"
        />
        {busy ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Stop the bots" onPress={onStop} style={({ pressed }) => [styles.send, styles.stop, pressed && { opacity: 0.7 }]}>
            <View style={styles.stopSquare} />
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send"
            disabled={!text.trim()}
            onPress={submit}
            style={({ pressed }) => [styles.send, !text.trim() && { opacity: 0.35 }, pressed && { opacity: 0.7 }]}
          >
            <Icon name="arrow-up" size={20} color={colors.primaryInk} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors, type) => ({
  replyBanner: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.xs },
  replyText: { flex: 1, color: colors.textSoft, fontSize: 13 },
  wrap: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.bg, paddingTop: space.xs },
  chips: { gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.xs },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 32,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  chipText: { ...type.small, color: colors.text, fontWeight: "600" },
  threadRow: { flexDirection: "row", paddingHorizontal: space.md, paddingTop: space.xs },
  threadChip: { flexDirection: "row", alignItems: "center", gap: 6, maxWidth: "100%", paddingVertical: 4, paddingHorizontal: space.sm, borderRadius: radius.pill, backgroundColor: colors.surface },
  threadChipNew: { backgroundColor: `${colors.accent}1F` },
  threadText: { ...type.small, fontSize: 12, color: colors.textSoft, flexShrink: 1 },
  threadSwitch: { ...type.small, fontSize: 12, color: colors.accentText, fontWeight: "600" },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: space.xs, paddingHorizontal: space.sm, paddingTop: space.xs },
  input: {
    ...type.body,
    flex: 1,
    minHeight: 40,
    maxHeight: 140,
    paddingHorizontal: space.md,
    paddingTop: 9,
    paddingBottom: 9,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  send: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary },
  stop: { backgroundColor: colors.danger },
  stopSquare: { width: 12, height: 12, borderRadius: 2, backgroundColor: colors.bg },
  progress: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm },
  progressText: { ...type.small, fontWeight: "600" },
  progressNote: { ...type.small, fontSize: 12 },
}));
