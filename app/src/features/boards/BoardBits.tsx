import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { BotAvatar, Icon, PressableRow } from "@/ui/primitives";
import { makeStyles, radius, space, useTheme } from "@/ui/theme";
import { previewText, readableInk, shortTime } from "@/features/inbox/format";
import { statusLabel, statusTone } from "./format";
import type { BoardSummary, KanbanTask } from "./types";

/** A board's badge: its emoji/initial on its colour. */
export function BoardBadge({ board, size = 40 }: { board: Pick<BoardSummary, "icon" | "color" | "name">; size?: number }) {
  const { colors } = useTheme();
  const fill = board.color || colors.raised;
  const glyph = board.icon || board.name.slice(0, 1).toUpperCase();
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.3, backgroundColor: fill, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontSize: size * 0.42, fontWeight: "700", color: board.color ? readableInk(fill) : colors.text }}>{glyph}</Text>
    </View>
  );
}

export function StatusPill({ status }: { status: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const tone = statusTone(status, colors);
  return (
    <View style={[styles.pill, { borderColor: tone }]}>
      <Text style={[styles.pillText, { color: tone }]}>{statusLabel(status)}</Text>
    </View>
  );
}

export function TaskRow({ task, now, onPress }: { task: KanbanTask; now: number; onPress: (task: KanbanTask) => void }) {
  const styles = useStyles();
  const { colors, type } = useTheme();
  const summary = previewText(task.latest_summary || task.last_failure_error || task.body || "");
  const at = (task.completed_at || task.started_at || task.created_at || 0) * 1000;
  return (
    <PressableRow onPress={() => onPress(task)} style={styles.row} accessibilityRole="button" accessibilityLabel={task.title}>
      {task.assignee ? <BotAvatar name={task.assignee} size={30} /> : <View style={styles.unassigned}><Icon name="person-add-outline" size={14} color={colors.faint} /></View>}
      <View style={styles.main}>
        <Text style={type.heading} numberOfLines={2}>
          {task.title}
        </Text>
        {summary ? (
          <Text style={type.small} numberOfLines={2}>
            {summary}
          </Text>
        ) : null}
        <View style={styles.meta}>
          <StatusPill status={task.status} />
          {task.assignee ? <Text style={type.small}>@{task.assignee}</Text> : <Text style={type.small}>Unassigned</Text>}
          {task.comment_count ? (
            <View style={styles.count}>
              <Icon name="chatbubble-outline" size={12} color={colors.muted} />
              <Text style={type.small}>{task.comment_count}</Text>
            </View>
          ) : null}
          <View style={{ flex: 1 }} />
          {at ? <Text style={type.small}>{shortTime(at, now)}</Text> : null}
        </View>
      </View>
    </PressableRow>
  );
}

const useStyles = makeStyles((colors) => ({
  row: { flexDirection: "row", alignItems: "flex-start", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md },
  main: { flex: 1, minWidth: 0, gap: 4 },
  meta: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: 2 },
  count: { flexDirection: "row", alignItems: "center", gap: 3 },
  unassigned: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  pill: { borderWidth: StyleSheet.hairlineWidth * 2, borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 1 },
  pillText: { fontSize: 11, fontWeight: "600" },
}));
