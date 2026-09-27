import React, { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import type { TimelineItem } from "@/features/chat/chatReducer";
import { Icon, IconButton, IconName } from "@/ui/primitives";
import { EASE_IN_OUT, SWAP_IN } from "@/ui/motion";
import { botColor, makeStyles, radius, space, useTheme } from "@/ui/theme";
import { useVoiceMode, type VoicePhase } from "./useVoiceMode";

type Props = {
  profile: string;
  botName: string;
  items: TimelineItem[];
  running: boolean;
  /** What the bot is doing right now (tool calls), shown while it thinks. */
  statusLine?: string;
  send: (text: string) => Promise<unknown> | void;
  interrupt: () => void;
  onClose: () => void;
};

const ORB = 76;

const COPY: Record<VoicePhase, { title: (bot: string) => string; hint: string; icon: IconName }> = {
  starting: { title: () => "Starting…", hint: "", icon: "mic-outline" },
  listening: { title: () => "Listening", hint: "Pause when you're done, or tap", icon: "mic" },
  paused: { title: () => "Mic off", hint: "Tap to talk", icon: "mic-off" },
  transcribing: { title: () => "Got it…", hint: "", icon: "ellipsis-horizontal" },
  thinking: { title: (bot) => `${bot} is thinking`, hint: "Tap to interrupt", icon: "ellipsis-horizontal" },
  speaking: { title: (bot) => `${bot} is speaking`, hint: "Tap to interrupt", icon: "volume-high" },
};

/**
 * Voice mode, in place of the composer: the chat above keeps the written conversation while
 * this runs the spoken one. The orb follows your voice while listening and breathes while the
 * bot works or talks.
 */
export function VoicePanel({ profile, botName, items, running, statusLine, send, interrupt, onClose }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const level = useSharedValue(0);
  const voice = useVoiceMode({ profile, items, running, send, interrupt, level });
  const { phase } = voice;
  const tint = botColor(profile, colors);
  const listening = phase === "listening";
  const busy = phase === "thinking" || phase === "transcribing" || phase === "speaking";

  // A slow breath while the bot works or talks; still under reduced motion.
  const breath = useSharedValue(0);
  useEffect(() => {
    cancelAnimation(breath);
    breath.set(0);
    if (!busy || reduced) return;
    const period = phase === "speaking" ? 650 : 1100;
    breath.set(
      withRepeat(
        withSequence(
          withTiming(1, { duration: period, easing: EASE_IN_OUT }),
          withTiming(0, { duration: period, easing: EASE_IN_OUT }),
        ),
        -1,
      ),
    );
  }, [breath, busy, phase, reduced]);

  // Animations start on the JS side (above and in the level setter); the styles only read values.
  const voiceGain = reduced ? 0 : 0.22;
  const orbStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + level.get() * voiceGain + breath.get() * 0.07 }],
  }));
  const haloStyle = useAnimatedStyle(() => ({
    opacity: listening ? 0.15 + level.get() * 0.5 : 0.12 + breath.get() * 0.2,
    transform: [{ scale: 1.18 + (listening ? level.get() * 0.35 : breath.get() * 0.12) }],
  }));

  const copy = COPY[phase];
  const fill = phase === "speaking" ? tint : phase === "paused" ? colors.raised : colors.primary;
  const ink = phase === "paused" ? colors.muted : phase === "speaking" ? "#FFFFFF" : colors.primaryInk;
  const caption =
    phase === "speaking" && voice.saying
      ? voice.saying
      : phase === "thinking" && statusLine
        ? statusLine
        : voice.heard
          ? `“${voice.heard}”`
          : `Talk to ${botName}. Your conversation is written into the chat.`;

  return (
    <View style={styles.box} accessibilityLabel="Voice mode">
      <Text style={styles.caption} numberOfLines={2}>
        {caption}
      </Text>
      <View style={styles.row}>
        <IconButton
          icon={voice.muted ? "mic-off" : "mic-outline"}
          label={voice.muted ? "Unmute microphone" : "Mute microphone"}
          size={20}
          filled
          color={voice.muted ? colors.danger : colors.textSoft}
          onPress={voice.togglePause}
          style={styles.side}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${copy.title(botName)}. ${copy.hint}`}
          onPress={voice.tap}
          hitSlop={12}
          style={styles.orbWrap}
        >
          <Animated.View style={[styles.halo, { backgroundColor: fill }, haloStyle]} />
          <Animated.View style={[styles.orb, { backgroundColor: fill }, orbStyle]}>
            <Animated.View key={copy.icon} entering={SWAP_IN}>
              <Icon name={copy.icon} size={28} color={ink} />
            </Animated.View>
          </Animated.View>
        </Pressable>
        <IconButton
          icon="close"
          label="End voice mode"
          size={22}
          filled
          color={colors.textSoft}
          onPress={onClose}
          style={styles.side}
        />
      </View>
      <Text style={styles.title} accessibilityLiveRegion="polite">
        {copy.title(botName)}
      </Text>
      <Text style={styles.hint}>{copy.hint || " "}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  box: {
    marginHorizontal: space.md,
    marginTop: space.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    alignItems: "center",
    gap: space.xs,
  },
  caption: { color: colors.textSoft, fontSize: 14, lineHeight: 19, textAlign: "center", minHeight: 38 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", alignSelf: "stretch", marginVertical: space.sm },
  side: { width: 44, height: 44 },
  orbWrap: { width: ORB * 1.5, height: ORB * 1.5, alignItems: "center", justifyContent: "center" },
  halo: { position: "absolute", width: ORB, height: ORB, borderRadius: ORB / 2 },
  orb: { width: ORB, height: ORB, borderRadius: ORB / 2, alignItems: "center", justifyContent: "center" },
  title: { color: colors.text, fontSize: 15, fontWeight: "600" },
  hint: { color: colors.faint, fontSize: 12 },
}));
