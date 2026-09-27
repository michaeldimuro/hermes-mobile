import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useGateway } from "@/lib/store/GatewayProvider";
import { Button, EmptyState, IconButton, ScreenHeader } from "@/ui/primitives";
import { makeStyles, space, useTheme } from "@/ui/theme";
import { DriverBanner } from "@/features/groups/DriverBanner";
import { GroupComposer } from "@/features/groups/GroupComposer";
import { GroupMessage, WorkingIndicator } from "@/features/groups/GroupMessage";
import { MemberStack } from "@/features/groups/MemberStack";
import { RoomSheet } from "@/features/groups/RoomSheet";
import type { TimelineItem } from "@/features/groups/groupEvents";
import { useGroupRoom } from "@/features/groups/useGroupRoom";

type Row = TimelineItem | { type: "working"; key: string };

export default function GroupRoomScreen() {
  const { roomId: rawId } = useLocalSearchParams<{ roomId: string }>();
  const styles = useStyles();
  const { colors, type } = useTheme();
  const roomId = String(Array.isArray(rawId) ? rawId[0] : rawId ?? "");
  const { connection, showToast } = useGateway();
  const room = useGroupRoom(roomId);
  const [sheetOpen, setSheetOpen] = useState(false);
  const listRef = useRef<FlatList<Row>>(null);

  const busy = room.activity.pending || Boolean(room.driver?.working);

  // Inverted list: newest first, with the live "working" row at the very bottom.
  const rows = useMemo<Row[]>(() => {
    const list: Row[] = [...room.timeline].reverse();
    if (busy) list.unshift({ type: "working", key: "working" });
    return list;
  }, [room.timeline, busy]);

  // Keep the newest message in view when something arrives.
  const newestKey = rows[0]?.key;
  useEffect(() => {
    if (newestKey) listRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, [newestKey]);

  const back = useCallback(() => (router.canGoBack() ? router.back() : router.replace("/")), []);

  const disband = useCallback(async () => {
    setSheetOpen(false);
    if (await room.disband()) {
      showToast("Room disbanded", "success");
      router.replace("/");
    }
  }, [room, showToast]);

  const renderItem = useCallback(
    ({ item }: { item: Row }) =>
      item.type === "working" ? (
        <WorkingIndicator member={room.activity.working} />
      ) : (
        <GroupMessage item={item} />
      ),
    [room.activity.working],
  );

  const title = room.room?.name ?? (room.loading ? "Loading…" : "Group chat");
  const subtitle = room.members.length ? room.members.map((m) => m.name).join(", ") : undefined;

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScreenHeader
        title={title}
        subtitle={subtitle}
        onBack={back}
        right={
          <View style={styles.headerRight}>
            {room.members.length ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Room members and actions"
                onPress={() => setSheetOpen(true)}
                hitSlop={6}
              >
                <MemberStack members={room.members} size={24} max={3} />
              </Pressable>
            ) : null}
            <IconButton icon="ellipsis-horizontal" label="Room options" onPress={() => setSheetOpen(true)} disabled={room.gone} />
          </View>
        }
      />
      <View style={styles.hairline} />
      {room.gone ? (
        <View style={styles.center}>
          <EmptyState
            icon="archive-outline"
            title="This room is gone"
            body="It was disbanded or no longer exists on this gateway."
            action={<Button title="Back to chats" variant="secondary" onPress={() => router.replace("/")} />}
          />
        </View>
      ) : room.loading && !room.timeline.length ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.muted} />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          inverted
          data={rows}
          keyExtractor={(row) => row.key}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          ListFooterComponent={
            room.members.length ? (
              <View style={styles.intro}>
                <MemberStack members={room.members} size={40} max={6} />
                <Text style={[type.heading, { textAlign: "center" }]}>{room.room?.name}</Text>
                <Text style={[type.small, { textAlign: "center" }]}>
                  Everyone replies by default. Tap an @name below to direct a message to specific bots.
                </Text>
              </View>
            ) : null
          }
        />
      )}
      {!room.gone ? (
        <>
          <DriverBanner driver={room.driver} onRetry={room.retry} onApprove={room.approve} />
          {connection !== "open" ? <Text style={styles.offline}>Reconnecting to Hermes…</Text> : null}
          <GroupComposer
            members={room.members}
            busy={busy}
            disabled={connection !== "open" || !room.room}
            onSend={room.send}
            onStop={room.stop}
          />
        </>
      ) : null}
      <RoomSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        name={room.room?.name ?? ""}
        members={room.members}
        busy={busy}
        onRename={room.rename}
        onStop={room.stop}
        onDisband={disband}
      />
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles((colors, type) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 2 },
  hairline: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { paddingVertical: space.md },
  intro: { alignItems: "center", gap: space.sm, paddingHorizontal: space.xxl, paddingTop: space.xl, paddingBottom: space.lg },
  offline: { ...type.small, textAlign: "center", color: colors.warn, marginBottom: space.xs },
}));
