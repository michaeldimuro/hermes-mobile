import React, { useCallback, useMemo, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useGateway } from "@/lib/store/GatewayProvider";
import type { ProfileRow } from "@/lib/gateway/types";
import { BotCard } from "@/features/bots/BotCard";
import { go, sortBots } from "@/features/bots/format";
import { Button, EmptyState, Icon, IconButton, ScreenHeader } from "@/ui/primitives";
import { makeStyles, radius, space, useTheme } from "@/ui/theme";

export default function BotsGallery() {
  const { colors, scheme } = useTheme();
  const styles = useStyles();
  const { profiles, refreshProfiles, activeBot, setActiveBot, connection } = useGateway();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const bots = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = sortBots(profiles);
    if (!q) return sorted;
    return sorted.filter((bot) =>
      [bot.name, bot.display_name, bot.description, bot.model, bot.provider].some((field) => field?.toLowerCase().includes(q)),
    );
  }, [profiles, query]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshProfiles();
    setRefreshing(false);
  }, [refreshProfiles]);

  const open = useCallback((name: string) => go.push(`/bots/${encodeURIComponent(name)}`), []);
  const chat = useCallback(
    (name: string) => {
      setActiveBot(name);
      go.chatWith(name);
    },
    [setActiveBot],
  );

  const renderItem = useCallback(
    ({ item }: { item: ProfileRow }) => <BotCard bot={item} active={item.name === activeBot} onOpen={open} onChat={chat} />,
    [activeBot, open, chat],
  );

  const offline = connection !== "open";
  const subtitle = offline
    ? connection === "connecting" || connection === "reconnecting"
      ? "Connecting…"
      : "Offline"
    : `${profiles.length} ${profiles.length === 1 ? "agent" : "agents"}`;

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Bots"
        subtitle={subtitle}
        onBack={router.canGoBack() ? () => router.back() : undefined}
        right={<IconButton icon="add" label="Create a bot" size={26} filled onPress={() => go.push("/bots/new")} />}
      />
      <FlatList
        data={bots}
        keyExtractor={(item) => item.name}
        renderItem={renderItem}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xxl }]}
        ItemSeparatorComponent={Separator}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accentText} colors={[colors.accentText]} progressBackgroundColor={colors.overlay} />}
        ListHeaderComponent={
          <View style={styles.search}>
            <Icon name="search" size={17} color={colors.muted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search bots, roles, models"
              placeholderTextColor={colors.faint}
              keyboardAppearance={scheme}
              autoCapitalize="none"
              autoCorrect={false}
              clearButtonMode="while-editing"
              returnKeyType="search"
              style={styles.searchInput}
              accessibilityLabel="Search bots"
            />
          </View>
        }
        ListEmptyComponent={
          query ? (
            <EmptyState icon="search" title="No matching bots" body={`Nothing matches “${query.trim()}”.`} />
          ) : offline ? (
            <EmptyState icon="cloud-offline-outline" title="Not connected" body="Bots appear once Hermes is reachable." />
          ) : (
            <EmptyState
              icon="people-outline"
              title="No bots yet"
              body="Create a specialised agent with its own persona, model and tools."
              action={<Button title="Create a bot" icon="add" variant="accent" onPress={() => go.push("/bots/new")} />}
            />
          )
        }
        ListFooterComponent={
          bots.length > 0 && !query ? (
            <Text style={styles.footer}>Each bot is a Hermes profile with its own persona, model, skills and tools.</Text>
          ) : null
        }
      />
    </View>
  );
}

function Separator() {
  return <View style={{ height: space.md }} />;
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: space.lg, paddingTop: space.xs, flexGrow: 1 },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    height: 44,
    paddingHorizontal: space.md,
    marginBottom: space.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.raised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 16, paddingVertical: 0 },
  footer: { fontSize: 12, color: colors.faint, textAlign: "center", marginTop: space.xl, paddingHorizontal: space.xl },
}));
