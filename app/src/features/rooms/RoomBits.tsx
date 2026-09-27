import React, { useEffect, useState } from "react";
import { ActivityIndicator, Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BotAvatar, Icon, Sheet } from "@/ui/primitives";
import { botColor, makeStyles, radius, space, useTheme } from "@/ui/theme";
import type { MirrorMember } from "./roomMirror";
import type { EarlierState } from "./useDesktopRoom";

/** Overlapping member avatars ("facepile"). */
/** Friendly sender label for a profile name (avatars and colours stay keyed by the profile name). */
export type DisplayName = (profile: string) => string;
const plain: DisplayName = (profile) => profile;

export function MemberFacepile({
  members,
  size = 24,
  max = 3,
  displayName = plain,
}: {
  members: MirrorMember[];
  size?: number;
  max?: number;
  displayName?: DisplayName;
}) {
  const styles = useStyles();
  const shown = members.slice(0, max);
  const extra = members.length - shown.length;
  const overlap = Math.round(size * 0.36);
  return (
    <View style={styles.pile} accessibilityLabel={`Members: ${members.map((m) => displayName(m.name)).join(", ")}`}>
      {shown.map((member, i) => (
        <View key={member.name} style={[styles.ring, { marginLeft: i ? -overlap : 0, borderRadius: size / 2 + 2, zIndex: shown.length - i }]}>
          <BotAvatar name={member.name} size={size} />
        </View>
      ))}
      {extra > 0 ? (
        <View style={[styles.ring, styles.more, { marginLeft: -overlap, width: size + 4, height: size + 4, borderRadius: size / 2 + 2 }]}>
          <Text style={[styles.moreText, { fontSize: size * 0.36 }]}>+{extra}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** Bottom sheet listing the room's members. */
export function MembersSheet({
  visible,
  onClose,
  members,
  title,
  displayName = plain,
}: {
  visible: boolean;
  onClose: () => void;
  members: MirrorMember[];
  title: string;
  displayName?: DisplayName;
}) {
  const styles = useStyles();
  const { colors, type } = useTheme();
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <ScrollView contentContainerStyle={styles.sheetList}>
        {members.map((member) => (
          <View key={member.name} style={styles.memberRow} accessible accessibilityLabel={`${displayName(member.name)}, @${member.handle}`}>
            <BotAvatar name={member.name} size={40} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[type.heading, { color: botColor(member.name, colors) }]} numberOfLines={1}>
                {displayName(member.name)}
              </Text>
              <Text style={type.small} numberOfLines={1}>
                @{member.handle}
                {member.connectionLabel && member.connectionLabel !== "This device" ? `  ·  ${member.connectionLabel}` : ""}
              </Text>
            </View>
          </View>
        ))}
        {!members.length ? <Text style={[type.small, styles.none]}>No members in this group yet.</Text> : null}
      </ScrollView>
    </Sheet>
  );
}

/** Replaces the composer: sending happens on the desktop for now. */
export function DesktopInfoBar() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.info, { paddingBottom: Math.max(insets.bottom, space.md) }]} accessibilityRole="text">
      <View style={styles.infoIcon}>
        <Icon name="desktop-outline" size={16} color={colors.accentText} />
      </View>
      <Text style={styles.infoText}>Replies to this group run in the Hermes desktop app. New messages appear here live.</Text>
    </View>
  );
}

/** "Load earlier messages (N)" pill at the top of the conversation. */
export function LoadEarlier({ omitted, state, found, onPress }: { omitted: number; state: EarlierState; found: number; onPress: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  if (omitted <= 0) return <View style={styles.topPad} />;
  if (state === "done") {
    return (
      <View style={styles.earlierWrap}>
        <Text style={styles.earlierNote}>
          {found ? `Showing ${found} recovered earlier message${found === 1 ? "" : "s"}` : "Earlier messages aren't available on this device"}
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.earlierWrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Load earlier messages, ${omitted}`}
        disabled={state === "loading"}
        onPress={onPress}
        style={({ pressed }) => [styles.earlier, pressed && { opacity: 0.7 }]}
      >
        {state === "loading" ? <ActivityIndicator size="small" color={colors.muted} /> : <Icon name="arrow-up" size={14} color={colors.textSoft} />}
        <Text style={styles.earlierText}>{state === "loading" ? "Loading earlier messages…" : `Load earlier messages (${omitted})`}</Text>
      </Pressable>
    </View>
  );
}

/** Pulsing placeholder bubbles while the room loads. */
export function RoomSkeleton() {
  const styles = useStyles();
  const [pulse] = useState(() => new Animated.Value(0.4));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  const shapes: { user?: boolean; width: `${number}%`; height: number }[] = [
    { width: "62%", height: 64 },
    { width: "48%", height: 40 },
    { user: true, width: "55%", height: 44 },
    { width: "70%", height: 88 },
    { width: "40%", height: 40 },
  ];
  return (
    <Animated.View style={[styles.skeleton, { opacity: pulse }]} accessibilityLabel="Loading messages">
      {shapes.map((shape, i) => (
        <View key={i} style={[styles.skRow, shape.user && styles.skUser]}>
          {!shape.user ? <View style={styles.skAvatar} /> : null}
          <View style={[styles.skBubble, { width: shape.width, height: shape.height }]} />
        </View>
      ))}
    </Animated.View>
  );
}

const useStyles = makeStyles((colors, type) => ({
  pile: { flexDirection: "row", alignItems: "center" },
  ring: { borderWidth: 2, borderColor: colors.bg, backgroundColor: colors.bg },
  more: { alignItems: "center", justifyContent: "center", backgroundColor: colors.raised },
  moreText: { color: colors.muted, fontWeight: "700" },
  sheetList: { paddingHorizontal: space.lg, paddingBottom: space.md, gap: space.xs },
  memberRow: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.sm, paddingVertical: space.sm },
  none: { paddingHorizontal: space.sm },
  info: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  infoIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: `${colors.accent}22`,
  },
  infoText: { ...type.small, flex: 1 },
  topPad: { height: space.md },
  earlierWrap: { alignItems: "center", paddingTop: space.lg, paddingBottom: space.xs },
  earlier: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
    paddingHorizontal: space.lg,
    height: 34,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  earlierText: { ...type.small, color: colors.textSoft, fontWeight: "600" },
  earlierNote: { ...type.small, fontSize: 12, color: colors.faint },
  skeleton: { flex: 1, paddingTop: space.lg, gap: space.lg },
  skRow: { flexDirection: "row", alignItems: "flex-start", gap: space.sm, paddingHorizontal: space.md },
  skUser: { justifyContent: "flex-end", paddingRight: space.lg },
  skAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.raised },
  skBubble: { borderRadius: radius.lg, backgroundColor: colors.raised },
}));
