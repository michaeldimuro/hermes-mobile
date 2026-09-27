import React, { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { Href, router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useGateway } from "@/lib/store/GatewayProvider";
import { isPinned, togglePin, usePins } from "@/lib/store/pins";
import type { SessionListRow } from "@/lib/gateway/types";
import { ConnectionBanner } from "@/features/shell/ConnectionBanner";
import { SESSION_FILTERS, SessionFilterId, useAllSessions } from "@/features/chat/useAllSessions";
import { BotAvatar, Button, EmptyState, haptic, Icon, IconButton, PressableRow, PressScale, Sheet } from "@/ui/primitives";
import { botTitle } from "@/features/chat/botMeta";
import { makeStyles, radius, space, useTheme } from "@/ui/theme";
import { ConversationRow, SectionHeader, StarterRow, useNow } from "./InboxRows";
import { SessionRow, SESSION_AVATAR } from "./SessionRows";
import { SessionActionSheet, useSessionMutations } from "./SessionActions";
import { SkeletonRows } from "./Skeleton";
import { InboxItem, inboxItems, sessionEmptyTitle, sessionKey, visibleSessions } from "./grouping";
import { Conversation, useConversations } from "./useConversations";

type Tab = "conversations" | "sessions";

const go = (href: string) => router.push(href as Href);

/** Long-press a conversation: pin it to the top of the inbox (on this phone) or unpin it. */
const pinMenu = (item: Conversation) => {
  haptic.press();
  Alert.alert(item.title, undefined, [
    { text: isPinned(item.key) ? "Unpin" : "Pin to top", onPress: () => togglePin(item.key) },
    { text: "Cancel", style: "cancel" },
  ]);
};

export function openConversation(item: Conversation) {
  if (item.kind === "bot") return go(`/bot/${encodeURIComponent(item.bot.name)}`);
  if (item.origin === "desktop") return go(`/room/${encodeURIComponent(item.roomId)}`);
  return go(`/groups/${encodeURIComponent(item.roomId)}`);
}

/** Home: Conversations (bots + group chats) by default, with a tab for every session across bots. */
export function InboxScreen() {
  const styles = useStyles();
  const { colors, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const { profiles, activeBot } = useGateway();
  const [tab, setTab] = useState<Tab>("conversations");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SessionFilterId>("all");
  const [refreshing, setRefreshing] = useState(false);
  const [compose, setCompose] = useState(false);
  const now = useNow();
  const { conversations, loading, refresh } = useConversations();
  const sessions = useAllSessions(tab === "sessions", filter);

  const mutations = useSessionMutations();
  const [actionTarget, setActionTarget] = useState<SessionListRow | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);

  const searching = query.trim().length > 0;
  const pins = usePins();
  const items = useMemo(() => inboxItems(conversations, query, pins), [conversations, query, pins]);
  const shownSessions = useMemo(
    () => visibleSessions(sessions.rows, { hidden: mutations.hidden, titles: mutations.titles, pinned: mutations.pinned, query }),
    [mutations.hidden, mutations.titles, mutations.pinned, query, sessions.rows],
  );

  const pull = useCallback(async () => {
    setRefreshing(true);
    await (tab === "conversations" ? refresh() : sessions.refresh());
    setRefreshing(false);
  }, [refresh, sessions, tab]);

  const openSession = useCallback(
    (row: SessionListRow) => go(`/chat/${encodeURIComponent(row.id)}?profile=${encodeURIComponent(row.profile ?? "default")}`),
    [],
  );
  const openActions = useCallback((row: SessionListRow) => {
    setActionTarget(row);
    setActionsOpen(true);
  }, []);

  const renderInboxItem = useCallback(
    ({ item }: { item: InboxItem }) => {
      if (item.type === "header") return <SectionHeader title={item.title} />;
      if (item.type === "starter") return <StarterRow item={item.item} separator={item.separator} onPress={openConversation} />;
      return (
        <ConversationRow
          item={item.item}
          now={now}
          separator={item.separator}
          onPress={openConversation}
          pinned={pins.includes(item.item.key)}
          onLongPress={pinMenu}
        />
      );
    },
    [now, pins],
  );

  const refreshControl = <RefreshControl refreshing={refreshing} onRefresh={pull} tintColor={colors.muted} />;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.heading}>Chats</Text>
        <IconButton icon="albums-outline" label="Boards" size={22} onPress={() => go("/boards")} />
        <IconButton icon="sparkles-outline" label="Bots" size={22} onPress={() => go("/bots")} />
        <IconButton icon="settings-outline" label="Settings" size={22} onPress={() => go("/settings")} />
      </View>
      <ConnectionBanner />
      <View style={styles.search}>
        <Icon name="search" size={16} color={colors.muted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={tab === "conversations" ? "Search bots and group chats" : "Search sessions"}
          placeholderTextColor={colors.faint}
          keyboardAppearance={scheme}
          autoCorrect={false}
          style={styles.searchInput}
          accessibilityLabel="Search"
        />
      </View>
      <View style={styles.tabs} accessibilityRole="tablist">
        {(["conversations", "sessions"] as const).map((id) => (
          <Pressable
            key={id}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === id }}
            aria-selected={tab === id}
            onPress={() => {
              if (tab !== id) haptic.tap();
              setTab(id);
            }}
            style={[styles.tab, tab === id && styles.tabActive]}
          >
            <Text style={[styles.tabText, tab === id && styles.tabTextActive]}>
              {id === "conversations" ? "Conversations" : "Sessions"}
            </Text>
          </Pressable>
        ))}
      </View>

      {tab === "conversations" ? (
        <FlatList
          data={items}
          keyExtractor={(item) => item.key}
          renderItem={renderInboxItem}
          refreshControl={refreshControl}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
          ListEmptyComponent={
            loading ? (
              <SkeletonRows />
            ) : searching ? (
              <EmptyState icon="search" title="No matches" />
            ) : (
              <EmptyState
                icon="sparkles-outline"
                title="No bots yet"
                body="Connect a bot to start a conversation."
                action={<Button title="Connect a bot" variant="secondary" onPress={() => go("/bots")} style={{ marginTop: space.sm }} />}
              />
            )
          }
        />
      ) : (
        <FlatList
          data={shownSessions}
          keyExtractor={sessionKey}
          renderItem={({ item, index }) => (
            <SessionRow
              row={item}
              bot={profiles.find((bot) => bot.name === (item.profile ?? "default"))}
              now={now}
              separator={index < shownSessions.length - 1}
              onPress={openSession}
              onLongPress={openActions}
              onDelete={mutations.confirmDelete}
            />
          )}
          ListHeaderComponent={
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
              {SESSION_FILTERS.map((option) => (
                <Pressable
                  key={option.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: filter === option.id }}
                  onPress={() => setFilter(option.id)}
                  style={[styles.filter, filter === option.id && styles.filterActive]}
                >
                  <Text style={[styles.filterText, filter === option.id && styles.filterTextActive]}>{option.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          }
          refreshControl={refreshControl}
          onEndReached={sessions.loadMore}
          onEndReachedThreshold={0.4}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
          ListFooterComponent={
            sessions.loading && shownSessions.length ? <ActivityIndicator color={colors.muted} style={{ margin: space.xl }} /> : null
          }
          ListEmptyComponent={
            sessions.loading ? (
              <SkeletonRows avatar={SESSION_AVATAR} />
            ) : (
              <EmptyState icon={searching ? "search" : "time-outline"} title={sessionEmptyTitle(filter, searching)} />
            )
          }
        />
      )}

      <PressScale
        accessibilityRole="button"
        accessibilityLabel="New chat or group"
        onPress={() => {
          haptic.press();
          setCompose(true);
        }}
        style={[styles.fab, { bottom: insets.bottom + space.lg }]}
      >
        <Icon name="create-outline" size={24} color={colors.primaryInk} />
      </PressScale>

      <Sheet visible={compose} onClose={() => setCompose(false)} title="Start something new">
        <PressableRow
          onPress={() => {
            setCompose(false);
            go(`/new?bot=${encodeURIComponent(activeBot)}`);
          }}
          style={styles.sheetRow}
        >
          <BotAvatar name={activeBot} size={40} />
          <View style={{ flex: 1 }}>
            <Text style={styles.sheetTitle}>New chat with {botTitle(profiles.find((bot) => bot.name === activeBot), activeBot)}</Text>
            <Text style={styles.sheetDetail}>A fresh session. Switch bots from the top of the chat.</Text>
          </View>
        </PressableRow>
        <PressableRow
          onPress={() => {
            setCompose(false);
            go("/groups/new");
          }}
          style={styles.sheetRow}
        >
          <View style={styles.sheetIcon}>
            <Icon name="people" size={20} color={colors.text} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.sheetTitle}>New group chat</Text>
            <Text style={styles.sheetDetail}>Several bots in one room, also shown in Hermes desktop</Text>
          </View>
        </PressableRow>
      </Sheet>

      <SessionActionSheet
        target={actionTarget}
        visible={actionsOpen}
        onClose={() => setActionsOpen(false)}
        onRename={mutations.rename}
        onDelete={mutations.confirmDelete}
        onTogglePin={mutations.togglePinned}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", paddingLeft: space.lg, paddingRight: space.sm, height: 52 },
  heading: { flex: 1, color: colors.text, fontSize: 28, fontWeight: "800", letterSpacing: -0.6 },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    marginHorizontal: space.lg,
    marginTop: space.xs,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 16, paddingVertical: 10 },
  tabs: { flexDirection: "row", margin: space.lg, marginBottom: space.sm, padding: 3, borderRadius: radius.pill, backgroundColor: colors.surface },
  tab: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: radius.pill },
  tabActive: { backgroundColor: colors.scheme === "light" ? colors.bg : colors.overlay, shadowColor: colors.shadow, shadowOpacity: 1, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  tabText: { color: colors.muted, fontSize: 14, fontWeight: "600" },
  tabTextActive: { color: colors.text },
  filters: { gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.sm },
  filter: { paddingHorizontal: 14, height: 32, justifyContent: "center", borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  filterActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterText: { color: colors.textSoft, fontSize: 13, fontWeight: "600" },
  filterTextActive: { color: colors.primaryInk },
  sheetRow: { marginHorizontal: space.sm },
  sheetTitle: { color: colors.text, fontSize: 16, fontWeight: "600" },
  sheetDetail: { color: colors.muted, fontSize: 13, marginTop: 2 },
  sheetIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.raised, alignItems: "center", justifyContent: "center" },
  fab: {
    position: "absolute",
    right: space.xl,
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    shadowColor: colors.shadow,
    shadowOpacity: 1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
}));
