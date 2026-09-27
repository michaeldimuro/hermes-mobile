import React, { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Href, router, useLocalSearchParams } from "expo-router";
import { TaskRow } from "@/features/boards/BoardBits";
import { defaultColumn, orderColumns, statusLabel } from "@/features/boards/format";
import { NewTaskSheet } from "@/features/boards/NewTaskSheet";
import type { KanbanTask } from "@/features/boards/types";
import { useBoard, useBoardActions, useBoardList } from "@/features/boards/useBoards";
import { Button, Chip, EmptyState, IconButton, ScreenHeader } from "@/ui/primitives";
import { makeStyles, space, useTheme } from "@/ui/theme";

/** One board: pick a column, see its cards, open one. */
export default function BoardScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const styles = useStyles();
  const { colors } = useTheme();
  const { data, error, refreshing, refresh, reload } = useBoard(slug);
  const { boards } = useBoardList();
  const actions = useBoardActions(slug);
  const [picked, setPicked] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [now] = useState(() => Date.now());
  const columns = useMemo(() => orderColumns(data?.columns ?? []).filter((c) => c.name !== "archived"), [data]);
  const column = picked ?? defaultColumn(columns);
  const tasks = columns.find((c) => c.name === column)?.tasks ?? [];
  const board = boards.find((b) => b.slug === slug);
  const total = columns.reduce((sum, c) => sum + c.tasks.length, 0);

  const open = (task: KanbanTask) =>
    router.push(`/boards/${encodeURIComponent(slug)}/${encodeURIComponent(task.id)}` as Href);

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title={board?.name ?? slug}
        subtitle={data ? `${total} task${total === 1 ? "" : "s"}` : undefined}
        onBack={() => router.back()}
        right={<IconButton icon="add" label="New task" filled onPress={() => setCreating(true)} />}
      />
      {columns.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabsWrap} contentContainerStyle={styles.tabs}>
          {/* Empty columns add nothing to tap; the open column always stays visible. */}
          {columns.filter((c) => c.tasks.length || c.name === column).map((c) => (
            <Chip
              key={c.name}
              label={`${statusLabel(c.name)} ${c.tasks.length}`}
              active={c.name === column}
              onPress={() => setPicked(c.name)}
            />
          ))}
        </ScrollView>
      ) : null}
      <FlatList
        data={tasks}
        keyExtractor={(task) => task.id}
        renderItem={({ item }) => <TaskRow task={item} now={now} onPress={open} />}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        ListEmptyComponent={
          !data && !error ? (
            <ActivityIndicator style={{ marginTop: space.xxl }} color={colors.muted} />
          ) : (
            <EmptyState
              icon={error ? "cloud-offline-outline" : "checkmark-done-outline"}
              title={error ? "Couldn't load this board" : `Nothing in ${statusLabel(column)}`}
              body={error ?? undefined}
              action={error ? <Button title="Try again" variant="secondary" onPress={refresh} /> : undefined}
            />
          )
        }
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.muted} />}
      />
      <NewTaskSheet
        visible={creating}
        onClose={() => setCreating(false)}
        onCreate={async (title, body, assignee) => {
          const failed = await actions.create(title, body, assignee);
          if (!failed) void reload();
          return failed;
        }}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  tabsWrap: { flexGrow: 0 },
  tabs: { gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: space.lg + 30 + space.md },
}));
