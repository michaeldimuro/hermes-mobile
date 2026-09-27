import React, { memo, useEffect, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import Markdown from "react-native-markdown-display";
import { BotAvatar } from "@/ui/primitives";
import { botColor, makeStyles, radius, space, useTheme } from "@/ui/theme";
import type { MemberView, TimelineItem } from "./groupEvents";

const AVATAR = 28;

/** One row of the group conversation: user bubble (right), bot reply (left, markdown), or a system notice. */
export const GroupMessage = memo(function GroupMessage({ item }: { item: TimelineItem }) {
  const styles = useStyles();
  const markdownStyles = useMarkdownStyles();
  const { colors } = useTheme();
  if (item.type === "user") {
    return (
      <View style={styles.userRow}>
        <View style={[styles.userBubble, item.pending && styles.pending]}>
          <Text style={styles.userText} selectable>
            {item.text}
          </Text>
        </View>
      </View>
    );
  }
  if (item.type === "notice") {
    const tint = item.tone === "error" ? colors.danger : item.tone === "warn" ? colors.warn : colors.muted;
    return (
      <View style={styles.noticeRow} accessibilityRole="text">
        <Text style={[styles.noticeText, { color: tint }]}>{item.text}</Text>
      </View>
    );
  }
  const tint = botColor(item.member.profile, colors);
  return (
    <View style={[styles.botRow, item.showHeader && styles.botRowFirst]}>
      <View style={styles.avatarCol}>{item.showHeader ? <BotAvatar name={item.member.profile} size={AVATAR} /> : null}</View>
      <View style={styles.botBody}>
        {item.showHeader ? (
          <Text style={[styles.botName, { color: tint }]} numberOfLines={1}>
            {item.member.name}
          </Text>
        ) : null}
        <View style={[styles.botBubble, { borderLeftColor: `${tint}66` }]}>
          <Markdown style={markdownStyles}>{item.text}</Markdown>
        </View>
      </View>
    </View>
  );
});

/** "<Bot> is working…" row with a gently pulsing dot trio. */
export function WorkingIndicator({ member, label }: { member: MemberView | null; label?: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [pulse] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(pulse, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  const tint = member ? botColor(member.profile, colors) : colors.muted;
  const text = label ?? (member ? `${member.name} is working…` : "The bots are wrapping up…");
  return (
    <View style={[styles.botRow, styles.botRowFirst]} accessibilityLiveRegion="polite" accessibilityLabel={text}>
      <View style={styles.avatarCol}>{member ? <BotAvatar name={member.profile} size={AVATAR} ring /> : null}</View>
      <View style={styles.working}>
        <View style={styles.dots}>
          {[0, 1, 2].map((i) => (
            <Animated.View
              key={i}
              style={[
                styles.dot,
                {
                  backgroundColor: tint,
                  opacity: pulse.interpolate({
                    inputRange: [0, (i + 1) / 4, (i + 2) / 4, 1],
                    outputRange: [0.25, 1, 0.25, 0.25],
                  }),
                },
              ]}
            />
          ))}
        </View>
        <Text style={styles.workingText} numberOfLines={1}>
          {text}
        </Text>
      </View>
    </View>
  );
}

/** Markdown styles are built from the palette; one sheet is cached per scheme. */
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
  userRow: { flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: space.lg, marginTop: space.sm },
  userBubble: {
    maxWidth: "82%",
    backgroundColor: colors.userBubble,
    borderRadius: radius.lg,
    borderBottomRightRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    paddingHorizontal: space.lg,
    paddingVertical: 10,
  },
  pending: { opacity: 0.55 },
  userText: { ...type.body, fontSize: 15, lineHeight: 22 },
  botRow: { flexDirection: "row", alignItems: "flex-start", paddingLeft: space.md, paddingRight: space.xl, marginTop: 3 },
  botRowFirst: { marginTop: space.md },
  avatarCol: { width: AVATAR, marginRight: space.sm, paddingTop: 2 },
  botBody: { flex: 1, minWidth: 0 },
  botName: { fontSize: 13, fontWeight: "700", marginBottom: 4, marginLeft: 2 },
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
  noticeRow: { alignItems: "center", paddingHorizontal: space.xl, marginVertical: space.md },
  noticeText: { ...type.small, fontSize: 12, textAlign: "center" },
  working: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: space.md,
    height: 34,
    maxWidth: "90%",
  },
  dots: { flexDirection: "row", gap: 4 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  workingText: { ...type.small, flexShrink: 1 },
}));
