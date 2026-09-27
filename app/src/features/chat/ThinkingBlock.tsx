import React, { memo, useEffect, useState } from "react";
import { ActivityIndicator, Animated, Pressable, Text, View } from "react-native";
import Reanimated, { FadeIn } from "react-native-reanimated";
import { Icon, IconName } from "@/ui/primitives";
import { EASE_OUT } from "@/ui/motion";

import { makeStyles, radius, space, useTheme } from "@/ui/theme";
import type { ActivityStep, AssistantItem, ToolStep } from "./chatReducer";

const REVEAL = FadeIn.duration(150).easing(EASE_OUT);

const TOOL_ICONS: [RegExp, IconName][] = [
  [/search|web|browse|browser|fetch|url/i, "globe-outline"],
  [/terminal|shell|exec|command|process/i, "terminal-outline"],
  [/file|read|write|patch|edit|diff/i, "document-text-outline"],
  [/delegate|subagent|spawn/i, "git-branch-outline"],
  [/image|vision|photo/i, "image-outline"],
  [/memory|recall|remember/i, "bookmark-outline"],
  [/todo|plan/i, "list-outline"],
  [/cron|schedule/i, "alarm-outline"],
  [/mail|message|send|discord|slack|telegram/i, "paper-plane-outline"],
  [/code|python|js/i, "code-slash-outline"],
];

export const toolIcon = (name: string): IconName => TOOL_ICONS.find(([re]) => re.test(name))?.[1] ?? "construct-outline";
export const toolLabel = (name: string) => name.replace(/^mcp_[^_]+_/, "").replace(/[_-]+/g, " ");

function Pulse() {
  const styles = useStyles();
  const [value] = useState(() => new Animated.Value(0.3));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(value, { toValue: 0.3, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [value]);
  return <Animated.View style={[styles.pulse, { opacity: value }]} />;
}

function ToolRow({ step }: { step: ToolStep }) {
  const styles = useStyles();
  const { colors, type } = useTheme();
  const [open, setOpen] = useState(false);
  const detail = step.summary || step.context;
  return (
    <Pressable onPress={() => (step.diff || detail ? setOpen((v) => !v) : undefined)} style={styles.step}>
      <View style={styles.stepIcon}>
        {step.state === "done" ? (
          <Icon name={toolIcon(step.name)} size={14} color={colors.muted} />
        ) : (
          <ActivityIndicator size="small" color={colors.accentText} style={{ transform: [{ scale: 0.7 }] }} />
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.stepTitle} numberOfLines={1}>
          {toolLabel(step.name)}
          {step.state === "generating" ? " · preparing" : ""}
          {typeof step.durationS === "number" ? <Text style={styles.stepMeta}>{`  ${step.durationS.toFixed(1)}s`}</Text> : null}
        </Text>
        {detail ? (
          <Text style={styles.stepDetail} numberOfLines={open ? undefined : 1}>
            {detail}
          </Text>
        ) : null}
        {open && step.diff ? (
          <Text style={[type.mono, styles.diff]} numberOfLines={40}>
            {step.diff}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function Steps({ steps }: { steps: ActivityStep[] }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.steps}>
      {steps.map((step) =>
        step.kind === "tool" ? (
          <ToolRow key={step.id} step={step} />
        ) : (
          <View key={step.id} style={styles.step}>
            <View style={styles.stepIcon}>
              <Icon name="chatbubble-ellipses-outline" size={14} color={colors.muted} />
            </View>
            <Text style={[styles.stepDetail, { flex: 1 }]}>{step.text}</Text>
          </View>
        ),
      )}
    </View>
  );
}

/** Collapsible "thinking" panel: model reasoning plus every tool call made during the turn. */
export const ThinkingBlock = memo(function ThinkingBlock({ turn, statusLine }: { turn: AssistantItem; statusLine?: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const hasContent = Boolean(turn.reasoning) || turn.activity.length > 0;
  if (!hasContent && !turn.streaming) return null;
  const tools = turn.activity.filter((step): step is ToolStep => step.kind === "tool");
  const running = tools.find((step) => step.state !== "done");
  const seconds = turn.startedAt && turn.endedAt ? Math.max(1, Math.round((turn.endedAt - turn.startedAt) / 1000)) : null;
  const label = turn.streaming
    ? running
      ? `${toolLabel(running.name)}…`
      : statusLine || (turn.text ? "Writing…" : "Thinking…")
    : seconds
      ? `Thought for ${seconds}s`
      : "Thought process";
  const counts = tools.length ? ` · ${tools.length} ${tools.length === 1 ? "step" : "steps"}` : "";

  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => hasContent && setOpen((v) => !v)}
        style={styles.header}
      >
        {turn.streaming ? <Pulse /> : <Icon name="sparkles-outline" size={14} color={colors.muted} />}
        <Text style={[styles.headerText, turn.streaming && { color: colors.textSoft }]} numberOfLines={1}>
          {label}
          <Text style={styles.stepMeta}>{counts}</Text>
        </Text>
        {hasContent ? <Icon name={open ? "chevron-up" : "chevron-down"} size={14} color={colors.faint} /> : null}
      </Pressable>
      {open ? (
        <Reanimated.View entering={REVEAL} style={styles.body}>
          {turn.reasoning ? <Text style={styles.reasoning}>{turn.reasoning.trim()}</Text> : null}
          {turn.activity.length ? <Steps steps={turn.activity} /> : null}
        </Reanimated.View>
      ) : null}
    </View>
  );
});

const useStyles = makeStyles((colors, type) => ({
  wrap: { marginBottom: space.sm },
  header: { flexDirection: "row", alignItems: "center", gap: space.sm, alignSelf: "flex-start", paddingVertical: 6 },
  headerText: { color: colors.muted, fontSize: 14, fontWeight: "500", flexShrink: 1 },
  pulse: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent, marginHorizontal: 3 },
  body: {
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
    paddingLeft: space.md,
    marginLeft: 6,
    marginTop: space.xs,
    gap: space.sm,
  },
  reasoning: { color: colors.muted, fontSize: 14, lineHeight: 20, fontStyle: "italic" },
  steps: { gap: 2 },
  step: { flexDirection: "row", gap: space.sm, paddingVertical: 4 },
  stepIcon: { width: 20, height: 20, alignItems: "center", justifyContent: "center", marginTop: 1 },
  stepTitle: { color: colors.textSoft, fontSize: 14, fontWeight: "500", textTransform: "capitalize" },
  stepMeta: { color: colors.faint, fontSize: 12, fontWeight: "400" },
  stepDetail: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  diff: {
    color: colors.textSoft,
    backgroundColor: colors.surface,
    padding: space.sm,
    borderRadius: radius.sm,
    marginTop: space.xs,
    fontSize: 11,
  },
}));
