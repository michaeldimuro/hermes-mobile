import React from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { haptic, Icon, IconName } from "@/ui/primitives";
import { CARD_IN, CARD_OUT } from "@/ui/motion";
import { makeStyles, radius, space, useTheme } from "@/ui/theme";
import { ControlAction, ControlSnapshot, everyText } from "./useSessionControl";

type Line = {
  key: string;
  icon: IconName;
  title: string;
  detail: string;
  paused: boolean;
  actions: { label: string; action: ControlAction; destructive?: boolean }[];
};

const isPaused = (status: string) => /pause|wait/i.test(status);

function lines(control: ControlSnapshot): Line[] {
  const out: Line[] = [];
  const { goal, loop, heartbeat } = control;
  if (goal && !/clear|done|achiev|complete/i.test(goal.status)) {
    const paused = isPaused(goal.status);
    out.push({
      key: "goal",
      icon: "flag-outline",
      title: goal.title,
      detail: [
        paused ? `Paused${goal.paused_reason ? `: ${goal.paused_reason}` : ""}` : "Working toward this goal",
        goal.max_turns ? `${goal.turns_used}/${goal.max_turns} turns` : "",
        goal.subgoals.length ? `${goal.subgoals.length} criteria` : "",
      ]
        .filter(Boolean)
        .join(" · "),
      paused,
      actions: [
        paused ? { label: "Resume goal", action: "goal.resume" } : { label: "Pause goal", action: "goal.pause" },
        { label: "Clear goal", action: "goal.clear", destructive: true },
      ],
    });
  }
  if (loop && !/stop|done|complete/i.test(loop.status)) {
    const paused = isPaused(loop.status);
    out.push({
      key: "loop",
      icon: "repeat-outline",
      title: loop.prompt,
      detail: [paused ? "Paused" : `Repeats ${everyText(loop.interval_seconds)}`, loop.ticks_fired ? `ran ${loop.ticks_fired}×` : ""]
        .filter(Boolean)
        .join(" · "),
      paused,
      actions: [
        paused ? { label: "Resume loop", action: "loop.resume" } : { label: "Pause loop", action: "loop.pause" },
        { label: "Stop loop", action: "loop.stop", destructive: true },
      ],
    });
  }
  if (heartbeat && !/clear/i.test(heartbeat.status)) {
    const paused = isPaused(heartbeat.status);
    out.push({
      key: "heartbeat",
      icon: "pulse-outline",
      title: heartbeat.prompt,
      detail: paused ? "Heartbeat paused" : `Check-in ${everyText(heartbeat.interval_seconds)} while idle`,
      paused,
      actions: [
        paused ? { label: "Resume check-ins", action: "heartbeat.resume" } : { label: "Pause check-ins", action: "heartbeat.pause" },
        { label: "Stop check-ins", action: "heartbeat.clear", destructive: true },
      ],
    });
  }
  return out;
}

/** Standing goal, loop and heartbeat for this chat: what the bot keeps doing on its own. */
export function ControlCard({ control, onAction }: { control: ControlSnapshot; onAction: (action: ControlAction) => void }) {
  const styles = useStyles();
  const { colors, type } = useTheme();
  const rows = lines(control);
  if (!rows.length) return null;
  const menu = (line: Line) => {
    haptic.press();
    Alert.alert(line.title.slice(0, 120), line.detail, [
      ...line.actions.map((a) => ({ text: a.label, style: a.destructive ? ("destructive" as const) : undefined, onPress: () => onAction(a.action) })),
      { text: "Cancel", style: "cancel" as const },
    ]);
  };
  return (
    <Animated.View entering={CARD_IN} exiting={CARD_OUT} style={styles.card}>
      {rows.map((line) => (
        <Pressable key={line.key} onPress={() => menu(line)} style={styles.line} accessibilityRole="button" accessibilityHint="Pause, resume or stop">
          <Icon name={line.icon} size={15} color={line.paused ? colors.faint : colors.accentText} />
          <View style={styles.text}>
            <Text style={styles.title} numberOfLines={1}>
              {line.title}
            </Text>
            <Text style={type.small} numberOfLines={1}>
              {line.detail}
            </Text>
          </View>
          <Icon name="ellipsis-horizontal" size={16} color={colors.faint} />
        </Pressable>
      ))}
    </Animated.View>
  );
}

const useStyles = makeStyles((colors) => ({
  card: {
    marginHorizontal: space.md,
    marginBottom: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
  },
  line: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: space.sm },
  text: { flex: 1, minWidth: 0 },
  title: { color: colors.textSoft, fontSize: 14, fontWeight: "500" },
}));
