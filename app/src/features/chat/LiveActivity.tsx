import React, { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { Icon } from "@/ui/primitives";
import { CARD_IN, CARD_OUT, EASE_OUT } from "@/ui/motion";

import { makeStyles, radius, space, useTheme } from "@/ui/theme";
import type { Subagent, Todo } from "./chatReducer";
import { toolLabel } from "./ThinkingBlock";

const REVEAL = FadeIn.duration(150).easing(EASE_OUT);

const doneStatus = (status: string) => /complete|done|success|finished|cancel|fail|error/i.test(status);

/** Delegated sub-agents and the bot's working plan, shown live above the composer. */
export function LiveActivity({
  subagents,
  todos,
  running,
  onOpenAgent,
}: {
  subagents: Subagent[];
  todos: Todo[];
  running: boolean;
  /** Open one sub-agent's live view (transcript tail, steer, stop). */
  onOpenAgent?: (agent: Subagent) => void;
}) {
  const styles = useStyles();
  const { colors, type } = useTheme();
  const [open, setOpen] = useState(false);
  const activeAgents = subagents.filter((agent) => !doneStatus(agent.status));
  const openTodos = todos.filter((todo) => !/complete|done|cancel/i.test(todo.status));
  if (!activeAgents.length && !(running && openTodos.length)) return null;
  const doneCount = todos.length - openTodos.length;
  const current = todos.find((todo) => /progress|active|doing/i.test(todo.status)) ?? openTodos[0];

  return (
    <Animated.View entering={CARD_IN} exiting={CARD_OUT}>
    <Pressable onPress={() => setOpen((v) => !v)} style={styles.card} accessibilityRole="button" accessibilityState={{ expanded: open }}>
      <View style={styles.head}>
        {activeAgents.length ? (
          <>
            <Icon name="git-branch-outline" size={15} color={colors.accentText} />
            <Text style={styles.headText} numberOfLines={1}>
              {activeAgents.length} sub-agent{activeAgents.length === 1 ? "" : "s"} working
            </Text>
          </>
        ) : (
          <>
            <Icon name="list-outline" size={15} color={colors.accentText} />
            <Text style={styles.headText} numberOfLines={1}>
              {current ? current.content : "Plan"}
            </Text>
          </>
        )}
        {todos.length ? <Text style={type.small}>{`${doneCount}/${todos.length}`}</Text> : null}
        <Icon name={open ? "chevron-down" : "chevron-up"} size={14} color={colors.faint} />
      </View>
      {todos.length ? (
        <View style={styles.progress}>
          <View style={[styles.progressFill, { width: `${(doneCount / todos.length) * 100}%` }]} />
        </View>
      ) : null}
      {open ? (
        <Animated.View entering={REVEAL} style={styles.body}>
          {subagents.map((agent) => (
            <Pressable
              key={agent.id}
              style={styles.line}
              onPress={onOpenAgent ? () => onOpenAgent(agent) : undefined}
              accessibilityRole="button"
              accessibilityHint="Opens its live output"
            >
              {doneStatus(agent.status) ? (
                <Icon name={/fail|error/i.test(agent.status) ? "close-circle" : "checkmark-circle"} size={15} color={/fail|error/i.test(agent.status) ? colors.danger : colors.success} />
              ) : (
                <ActivityIndicator size="small" color={colors.accentText} style={{ transform: [{ scale: 0.65 }] }} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.lineText} numberOfLines={2}>
                  {agent.goal}
                </Text>
                <Text style={type.small} numberOfLines={1}>
                  {[agent.model, agent.lastTool && `using ${toolLabel(agent.lastTool)}`, agent.toolCount && `${agent.toolCount} tools`]
                    .filter(Boolean)
                    .join(" · ") || agent.status}
                </Text>
              </View>
              {onOpenAgent ? <Icon name="chevron-forward" size={14} color={colors.faint} /> : null}
            </Pressable>
          ))}
          {todos.map((todo, index) => {
            const done = /complete|done/i.test(todo.status);
            const active = /progress|active|doing/i.test(todo.status);
            return (
              <View key={todo.id ?? index} style={styles.line}>
                <Icon
                  name={done ? "checkmark-circle" : active ? "ellipse" : "ellipse-outline"}
                  size={15}
                  color={done ? colors.success : active ? colors.accentText : colors.faint}
                />
                <Text style={[styles.lineText, done && styles.strike]}>{todo.content}</Text>
              </View>
            );
          })}
        </Animated.View>
      ) : null}
    </Pressable>
    </Animated.View>
  );
}

const useStyles = makeStyles((colors, type) => ({
  card: {
    marginHorizontal: space.md,
    marginBottom: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
  },
  head: { flexDirection: "row", alignItems: "center", gap: space.sm },
  headText: { color: colors.textSoft, fontSize: 14, fontWeight: "500", flex: 1 },
  progress: { height: 3, borderRadius: 2, backgroundColor: colors.raised, marginTop: space.sm, overflow: "hidden" },
  progressFill: { height: 3, backgroundColor: colors.accent },
  body: { marginTop: space.sm, gap: space.sm },
  line: { flexDirection: "row", gap: space.sm, alignItems: "flex-start" },
  lineText: { color: colors.textSoft, fontSize: 14, lineHeight: 19, flex: 1 },
  strike: { color: colors.faint, textDecorationLine: "line-through" },
}));
