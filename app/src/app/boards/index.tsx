import React from "react";
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { Href, router } from "expo-router";
import { BoardBadge } from "@/features/boards/BoardBits";
import { statusLabel } from "@/features/boards/format";
import type { BoardSummary } from "@/features/boards/types";
import { useBoardList } from "@/features/boards/useBoards";
import { Button, EmptyState, Icon, PressableRow, ScreenHeader } from "@/ui/primitives";
import { makeStyles, space, useTheme } from "@/ui/theme";

const ATTENTION = ["review", "blocked", "running", "ready"];

/** What a board needs from you, in a few words: "2 in review · 3 blocked · 12 done". */
function boardLine(board: BoardSummary) {
  const parts = ATTENTION.filter((status) => board.counts[status]).map(
    (status) => `${board.counts[status]} ${statusLabel(status).toLowerCase()}`,
  );
  if (board.counts.done) parts.push(`${board.counts.done} done`);
  return parts.join(" · ") || (board.total ? `${board.total} tasks` : "Empty");
}

/** Every Hermes Kanban board, busiest first. */
export default function BoardsScreen() {
  const styles = useStyles();
  const { colors, type } = useTheme();
  const { boards, data, error, refreshing, refresh } = useBoardList();
  const sorted = [...boards].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  return (
    <View style={styles.screen}>
      <ScreenHeader title="Boards" subtitle="Work your bots are doing" onBack={() => router.back()} />
      <FlatList
        data={sorted}
        keyExtractor={(board) => board.slug}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        renderItem={({ item }) => (
          <PressableRow
            style={styles.row}
            onPress={() => router.push(`/boards/${encodeURIComponent(item.slug)}` as Href)}
            accessibilityRole="button"
            accessibilityLabel={`${item.name} board`}
          >
            <BoardBadge board={item} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={type.heading} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={type.small} numberOfLines={1}>
                {boardLine(item)}
              </Text>
            </View>
            {item.counts.review || item.counts.blocked ? <View style={styles.dot} /> : null}
            <Icon name="chevron-forward" size={16} color={colors.faint} />
          </PressableRow>
        )}
        ListEmptyComponent={
          !data && !error ? (
            <ActivityIndicator style={{ marginTop: space.xxl }} color={colors.muted} />
          ) : (
            <EmptyState
              icon="albums-outline"
              title={error ? "Couldn't load boards" : "No boards yet"}
              body={error ?? "Boards appear here when your bots use Hermes Kanban."}
              action={error ? <Button title="Try again" variant="secondary" onPress={refresh} /> : undefined}
            />
          )
        }
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.muted} />}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: space.lg + 40 + space.md },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.warn },
}));
