import React, { memo } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { BotAvatar, Icon, PressableRow } from "@/ui/primitives";
import { makeStyles, space, useTheme } from "@/ui/theme";
import { deliveryIcon, deliveryLabel, humanizeSchedule, jobIsPaused, jobTitle, lastRunStatus, relativeTime } from "./format";
import type { CronJob } from "./types";
import { Pill, StatusDot } from "./ui";

export const JobRow = memo(function JobRow({
  job,
  running,
  now,
  onPress,
}: {
  job: CronJob;
  running: boolean;
  now: number;
  onPress: (job: CronJob) => void;
}) {
  const paused = jobIsPaused(job);
  const status = running ? { label: "Running", tone: "success" as const } : lastRunStatus(job);
  const schedule = humanizeSchedule(job.schedule, job.schedule_display);
  const owner = job.profile ?? job.profile_name ?? "default";
  const next = paused ? "Paused" : job.next_run_at ? `Next ${relativeTime(job.next_run_at, now)}` : "No upcoming run";
  const delivery = deliveryLabel(job.deliver, job.origin);
  const styles = useStyles();
  const { colors, type } = useTheme();

  return (
    <PressableRow
      accessibilityRole="button"
      accessibilityLabel={`${jobTitle(job)}, ${owner}. ${schedule}. ${next}. Last run ${status.label}. Delivers to ${delivery}.`}
      accessibilityHint="Shows actions for this automation"
      onPress={() => onPress(job)}
      style={[styles.row, paused && { opacity: 0.6 }]}
    >
      <BotAvatar name={owner} size={38} />
      <View style={styles.body}>
        <View style={styles.titleLine}>
          <Text style={styles.title} numberOfLines={1}>
            {jobTitle(job)}
          </Text>
          {paused ? <Pill label="Paused" tone="warn" icon="pause" /> : null}
        </View>
        <Text style={styles.schedule} numberOfLines={1}>
          <Icon name="repeat" size={12} color={colors.accentText} /> {schedule}
        </Text>
        <View style={styles.meta}>
          <Text style={type.small}>{next}</Text>
          <Text style={styles.dot}>·</Text>
          {running ? <ActivityIndicator size="small" color={colors.success} /> : <StatusDot tone={status.tone} size={6} />}
          <Text style={type.small} numberOfLines={1}>
            {status.label}
          </Text>
        </View>
        <View style={styles.meta}>
          <Icon name={deliveryIcon(job.deliver)} size={12} color={colors.faint} />
          <Text style={[type.small, { color: colors.faint, flexShrink: 1 }]} numberOfLines={1}>
            {owner} · {delivery}
          </Text>
        </View>
      </View>
      <Icon name="ellipsis-horizontal" size={18} color={colors.faint} />
    </PressableRow>
  );
});

const useStyles = makeStyles((colors, type) => ({
  row: { borderRadius: 0, alignItems: "flex-start", paddingVertical: space.md },
  body: { flex: 1, minWidth: 0, gap: 3 },
  titleLine: { flexDirection: "row", alignItems: "center", gap: space.sm },
  title: { ...type.heading, fontSize: 15, flexShrink: 1 },
  schedule: { color: colors.textSoft, fontSize: 13, fontWeight: "500" },
  meta: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { color: colors.faint, fontSize: 13 },
}));
