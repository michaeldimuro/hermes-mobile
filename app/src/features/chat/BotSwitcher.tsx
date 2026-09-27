import React, { useMemo, useState } from "react";
import { FlatList, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { useGateway } from "@/lib/store/GatewayProvider";
import { BotAvatar, Icon, PressableRow, Sheet } from "@/ui/primitives";
import { makeStyles, radius, space, useTheme } from "@/ui/theme";
import { botTitle } from "./botMeta";

/** Grok's model picker, reimagined: pick which Hermes bot you are talking to. */
export function BotSwitcher({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (name: string) => void }) {
  const styles = useStyles();
  const { colors, type } = useTheme();
  const { profiles, activeBot } = useGateway();
  const [query, setQuery] = useState("");
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...profiles]
      .filter((bot) => bot.role !== "setup")
      .filter((bot) => !needle || `${bot.name} ${bot.display_name ?? ""} ${bot.description ?? ""}`.toLowerCase().includes(needle))
      .sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.name.localeCompare(b.name));
  }, [profiles, query]);

  const go = (path: "/bots" | "/groups/new") => {
    onClose();
    router.push(path);
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Choose a bot">
      {profiles.length > 6 ? (
        <View style={styles.search}>
          <Icon name="search" size={16} color={colors.muted} />
          <TextInput value={query} onChangeText={setQuery} placeholder="Search bots and roles" placeholderTextColor={colors.faint} style={styles.searchInput} />
        </View>
      ) : null}
      <FlatList
        data={rows}
        keyExtractor={(bot) => bot.name}
        keyboardShouldPersistTaps="handled"
        style={{ flexGrow: 0 }}
        renderItem={({ item }) => {
          const active = item.name === activeBot;
          return (
            <PressableRow
              onPress={() => {
                onPick(item.name);
                onClose();
              }}
              style={[styles.row, active && styles.rowActive]}
              accessibilityState={{ selected: active }}
            >
              <BotAvatar name={item.name} size={40} ring={active} />
              <View style={{ flex: 1 }}>
                <Text style={type.heading} numberOfLines={1}>
                  {botTitle(item)}
                </Text>
                <Text style={type.small} numberOfLines={1}>
                  {item.description || "General assistant"}
                </Text>
              </View>
              {item.model ? (
                <Text style={styles.model} numberOfLines={1}>
                  {item.model}
                </Text>
              ) : null}
              {active ? <Icon name="checkmark-circle" size={20} color={colors.accentText} /> : null}
            </PressableRow>
          );
        }}
      />
      <View style={styles.footer}>
        <PressableRow onPress={() => go("/groups/new")} style={styles.footerRow}>
          <Icon name="people-outline" size={18} color={colors.textSoft} />
          <Text style={styles.footerText}>New group chat</Text>
        </PressableRow>
        <PressableRow onPress={() => go("/bots")} style={styles.footerRow}>
          <Icon name="options-outline" size={18} color={colors.textSoft} />
          <Text style={styles.footerText}>Manage bots</Text>
        </PressableRow>
      </View>
    </Sheet>
  );
}

const useStyles = makeStyles((colors, type) => ({
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    marginHorizontal: space.lg,
    marginBottom: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.raised,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: 10 },
  row: { marginHorizontal: space.sm },
  rowActive: { backgroundColor: colors.raised },
  model: { color: colors.faint, fontSize: 12, maxWidth: 110 },
  footer: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border, marginTop: space.sm, paddingTop: space.sm, paddingHorizontal: space.sm },
  footerRow: { flex: 1, justifyContent: "center", gap: space.sm },
  footerText: { color: colors.textSoft, fontSize: 14, fontWeight: "500" },
}));
