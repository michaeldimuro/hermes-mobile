import React from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { BotAvatar, Button, haptic, Sheet } from "@/ui/primitives";
import { makeStyles, radius, space, useTheme } from "@/ui/theme";
import {
  deliveryLabel,
  formatShortDate,
  humanizeSchedule,
  jobIsPaused,
  jobTitle,
  lastRunStatus,
  relativeTime,
} from "./format";
import type { CronJob } from "./types";
import { toneColor } from "./ui";

function when(iso: string | null | undefined, now: number) {
  if (!iso) return "Never";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "Unknown" : `${relativeTime(iso, now)} · ${formatShortDate(d)}`;
}

export function JobActionsSheet({
  job,
  now,
  running,
  onClose,
  onRunNow,
  onTogglePause,
  onDelete,
}: {
  job: CronJob | null;
  /** Clock for relative times; the caller ticks it so the sheet stays in step with the list. */
  now: number;
  running: boolean;
  onClose: () => void;
  onRunNow: (job: CronJob) => void;
  onTogglePause: (job: CronJob, pause: boolean) => void;
  onDelete: (job: CronJob) => void;
}) {
  const styles = useStyles();
  const { colors, type } = useTheme();
  if (!job) return <Sheet visible={false} onClose={onClose}>{null}</Sheet>;
  const paused = jobIsPaused(job);
  const status = lastRunStatus(job);
  const owner = job.profile ?? job.profile_name ?? "default";
  const error = job.last_error || job.last_delivery_error;

  const confirmDelete = () => {
    haptic.warn();
    Alert.alert("Delete automation?", `"${jobTitle(job)}" will stop running and be removed from ${owner}.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          onClose();
          onDelete(job);
        },
      },
    ]);
  };

  return (
    <Sheet visible onClose={onClose}>
      <ScrollView contentContainerStyle={styles.content} bounces={false}>
        <View style={styles.head}>
          <BotAvatar name={owner} size={44} ring />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={type.title} numberOfLines={2}>
              {jobTitle(job)}
            </Text>
            <Text style={type.small}>{owner}</Text>
          </View>
        </View>

        <View style={styles.facts}>
          <Fact label="Schedule" value={humanizeSchedule(job.schedule, job.schedule_display)} />
          <Fact label="Next run" value={paused ? "Paused" : when(job.next_run_at, now)} />
          <Fact label="Last run" value={job.last_run_at ? when(job.last_run_at, now) : "Never"} />
          <Fact label="Result" value={running ? "Running…" : status.label} color={toneColor(running ? "success" : status.tone, colors)} />
          <Fact label="Delivers to" value={deliveryLabel(job.deliver, job.origin)} />
          {job.repeat?.completed ? <Fact label="Runs" value={String(job.repeat.completed)} /> : null}
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={[type.small, { color: colors.danger }]} numberOfLines={4}>
              {error}
            </Text>
          </View>
        ) : null}

        {job.prompt ? (
          <View style={styles.prompt}>
            <Text style={type.caption}>PROMPT</Text>
            <Text style={[type.small, { color: colors.textSoft }]} numberOfLines={6} selectable>
              {job.prompt}
            </Text>
          </View>
        ) : null}

        <View style={styles.actions}>
          <Button
            title={running ? "Running…" : "Run now"}
            icon="play"
            variant="accent"
            disabled={running}
            onPress={() => {
              onClose();
              onRunNow(job);
            }}
          />
          <Button
            title={paused ? "Resume" : "Pause"}
            icon={paused ? "play-circle-outline" : "pause-circle-outline"}
            variant="secondary"
            onPress={() => {
              onClose();
              onTogglePause(job, !paused);
            }}
          />
          <Button title="Delete" icon="trash-outline" variant="danger" onPress={confirmDelete} />
        </View>
      </ScrollView>
    </Sheet>
  );
}

function Fact({ label, value, color }: { label: string; value: string; color?: string }) {
  const styles = useStyles();
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={[styles.factValue, color ? { color } : null]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const useStyles = makeStyles((colors, type) => ({
  content: { paddingHorizontal: space.xl, paddingBottom: space.sm, gap: space.lg },
  head: { flexDirection: "row", alignItems: "center", gap: space.md },
  facts: {
    backgroundColor: colors.raised,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  fact: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: space.lg,
    paddingVertical: space.sm,
  },
  factLabel: { ...type.small },
  factValue: { color: colors.text, fontSize: 14, fontWeight: "500", flexShrink: 1, textAlign: "right" },
  errorBox: { backgroundColor: colors.dangerBg, borderRadius: radius.md, padding: space.md },
  prompt: { gap: space.xs },
  actions: { gap: space.sm },
}));
