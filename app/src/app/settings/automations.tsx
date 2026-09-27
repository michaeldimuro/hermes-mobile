import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Button, Chip, EmptyState, IconButton, ScreenHeader } from "@/ui/primitives";
import { makeStyles, radius, space, useTheme } from "@/ui/theme";
import { BotChips } from "@/features/settings/BotChips";
import { jobIsPaused } from "@/features/settings/format";
import { JobActionsSheet } from "@/features/settings/JobActionsSheet";
import { JobRow } from "@/features/settings/JobRow";
import { NewAutomationSheet } from "@/features/settings/NewAutomationSheet";
import type { CronJob } from "@/features/settings/types";
import { useAutomations } from "@/features/settings/useAutomations";

/** Re-render every 30s so "Next in 5m" stays honest. */
function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

const nextRunValue = (job: CronJob) => {
  if (jobIsPaused(job) || !job.next_run_at) return Number.POSITIVE_INFINITY;
  const t = Date.parse(job.next_run_at);
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
};

export default function AutomationsScreen() {
  const auto = useAutomations();
  const styles = useStyles();
  const { colors, type } = useTheme();
  const now = useNow();
  const [filter, setFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<CronJob | null>(null);
  const [creating, setCreating] = useState(false);

  const owners = useMemo(
    () => [...new Set(auto.jobs.map((j) => j.profile ?? "default"))].sort().map((name) => ({ name })),
    [auto.jobs],
  );
  const visible = useMemo(
    () =>
      auto.jobs
        .filter((j) => !filter || (j.profile ?? "default") === filter)
        .sort((a, b) => nextRunValue(a) - nextRunValue(b)),
    [auto.jobs, filter],
  );
  const pausedCount = auto.jobs.filter(jobIsPaused).length;

  // Keep the open sheet in sync with live updates.
  const current = selected
    ? auto.jobs.find((j) => j.id === selected.id && j.profile === selected.profile) ?? selected
    : null;

  const { isRunning } = auto;
  const renderItem = useCallback(
    ({ item, index }: { item: CronJob; index: number }) => (
      <View style={[styles.itemWrap, index === 0 && styles.first, index === visible.length - 1 && styles.last]}>
        <JobRow job={item} running={isRunning(item)} now={now} onPress={setSelected} />
      </View>
    ),
    [isRunning, now, visible.length, styles],
  );

  const subtitle = auto.jobs.length
    ? `${auto.jobs.length} scheduled${pausedCount ? ` · ${pausedCount} paused` : ""}`
    : undefined;

  const header =
    owners.length > 1 ? (
      <View style={styles.filters}>
        <BotChips
          profiles={owners}
          value={filter}
          onChange={(name) => setFilter(filter === name ? null : name)}
          leading={<Chip label="All" active={filter === null} onPress={() => setFilter(null)} />}
        />
      </View>
    ) : (
      <View style={{ height: space.sm }} />
    );

  const empty = auto.loading ? (
    <ActivityIndicator style={{ marginTop: space.xxl }} color={colors.muted} />
  ) : auto.error ? (
    <EmptyState
      icon="cloud-offline-outline"
      title="Couldn't load automations"
      body={auto.error}
      action={<Button title="Try again" variant="secondary" onPress={auto.refresh} />}
    />
  ) : (
    <EmptyState
      icon="alarm-outline"
      title="No automations yet"
      body="Have a bot run a prompt on a schedule, like a morning briefing, an hourly check or a weekly report."
      action={<Button title="New automation" icon="add" variant="accent" onPress={() => setCreating(true)} />}
    />
  );

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Automations"
        subtitle={subtitle}
        onBack={() => router.back()}
        right={<IconButton icon="add" label="New automation" filled onPress={() => setCreating(true)} />}
      />
      <FlatList
        data={visible}
        keyExtractor={(j) => `${j.profile ?? "default"}:${j.id}`}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ItemSeparatorComponent={Separator}
        ListFooterComponent={
          auto.error && auto.jobs.length ? <Text style={[type.small, styles.footerError]}>{auto.error}</Text> : null
        }
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={auto.refreshing} onRefresh={auto.refresh} tintColor={colors.muted} />}
      />

      <JobActionsSheet
        job={current}
        now={now}
        running={current ? auto.isRunning(current) : false}
        onClose={() => setSelected(null)}
        onRunNow={auto.runNow}
        onTogglePause={auto.setPaused}
        onDelete={auto.remove}
      />
      <NewAutomationSheet
        visible={creating}
        onClose={() => setCreating(false)}
        onCreate={auto.create}
        loadTargets={auto.deliveryTargets}
      />
    </View>
  );
}

function Separator() {
  const styles = useStyles();
  return (
    <View style={styles.sepWrap}>
      <View style={styles.sep} />
    </View>
  );
}

const useStyles = makeStyles((colors, type) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  list: { paddingBottom: space.xxl * 2 },
  filters: { paddingTop: space.sm, paddingBottom: space.lg },
  itemWrap: {
    marginHorizontal: space.lg,
    overflow: "hidden",
    backgroundColor: colors.surface,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  first: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, borderTopWidth: StyleSheet.hairlineWidth },
  last: { borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  sepWrap: {
    marginHorizontal: space.lg,
    backgroundColor: colors.surface,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 66 },
  footerError: { color: colors.danger, textAlign: "center", marginTop: space.lg, paddingHorizontal: space.lg },
}));
