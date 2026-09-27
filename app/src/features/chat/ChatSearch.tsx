import React from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { IconButton } from "@/ui/primitives";
import { makeStyles, radius, space, useTheme } from "@/ui/theme";
import type { TimelineItem } from "./chatReducer";

/** Searchable text of a timeline item (what you'd remember reading in it). */
export function itemText(item: TimelineItem): string {
  switch (item.kind) {
    case "user":
      return [item.text, ...(item.files ?? [])].join(" ");
    case "assistant":
      return [item.text, ...(item.files ?? []).map((file) => file.name)].join(" ");
    case "side":
      return `${item.question} ${item.text}`;
    case "notice":
      return item.text;
    case "inbound":
      return JSON.stringify(item.inbound);
  }
}

/** Ids of items matching `query`, newest first (the list's own order). */
export function searchTimeline(newestFirst: TimelineItem[], query: string): string[] {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];
  return newestFirst.filter((item) => itemText(item).toLowerCase().includes(needle)).map((item) => item.id);
}

export function ChatSearchBar({
  query,
  onQuery,
  index,
  count,
  onStep,
  onClose,
}: {
  query: string;
  onQuery: (text: string) => void;
  index: number;
  count: number;
  /** +1 = older match, -1 = newer match. */
  onStep: (direction: 1 | -1) => void;
  onClose: () => void;
}) {
  const styles = useStyles();
  const { colors, scheme } = useTheme();
  return (
    <View style={styles.bar}>
      <TextInput
        value={query}
        onChangeText={onQuery}
        placeholder="Search this chat"
        placeholderTextColor={colors.faint}
        keyboardAppearance={scheme}
        autoFocus
        autoCorrect={false}
        returnKeyType="search"
        onSubmitEditing={() => onStep(1)}
        style={styles.input}
        accessibilityLabel="Search this chat"
      />
      <Text style={styles.count} accessibilityLiveRegion="polite">
        {query.trim().length < 2 ? "" : count ? `${index + 1} of ${count}` : "No matches"}
      </Text>
      <IconButton icon="chevron-up" label="Older match" size={20} onPress={() => onStep(1)} disabled={!count} />
      <IconButton icon="chevron-down" label="Newer match" size={20} onPress={() => onStep(-1)} disabled={!count} />
      <IconButton icon="close" label="Close search" size={20} onPress={onClose} />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    marginHorizontal: space.md,
    marginBottom: space.xs,
    paddingLeft: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
  },
  input: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: 9 },
  count: { color: colors.muted, fontSize: 12, marginRight: space.xs },
}));
