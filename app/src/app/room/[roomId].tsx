import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, KeyboardAvoidingView, NativeScrollEvent, NativeSyntheticEvent, Platform, Pressable, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useGateway } from "@/lib/store/GatewayProvider";
import { botTitle } from "@/features/chat/botMeta";
import { Button, EmptyState, Icon, IconButton, ScreenHeader } from "@/ui/primitives";
import { makeStyles, space, useTheme } from "@/ui/theme";
import { RequestCard } from "@/features/chat/RequestCard";
import { latestThreadOf, RoomComposer, RoomProgress } from "@/features/rooms/RoomComposer";
import { botMentionTag } from "@/features/rooms/engine/roundPrompt";
import { rosterFromProfiles, useGroupSend } from "@/features/rooms/engine/useGroupSend";
import { LoadEarlier, MemberFacepile, RoomSkeleton } from "@/features/rooms/RoomBits";
import { RoomManageSheet } from "@/features/rooms/RoomManageSheet";
import { heldMemberNames, holdText } from "@/features/rooms/engine/roomHolds";
import { disbandDesktopRoom, renameDesktopRoom, setDesktopRoomMembers } from "@/features/rooms/engine/roomCreate";
import { RoomRow } from "@/features/rooms/RoomMessage";
import type { MirrorEntry, MirrorMember, TimelineRow } from "@/features/rooms/roomMirror";
import { useDesktopRoom } from "@/features/rooms/useDesktopRoom";

const NEAR_BOTTOM_PX = 160;

/** A Hermes desktop group chat: live from the gateway mirror, postable from the phone. */
export default function DesktopRoomScreen() {
  const { roomId: rawId } = useLocalSearchParams<{ roomId: string }>();
  const roomId = String(Array.isArray(rawId) ? rawId[0] : (rawId ?? ""));
  const styles = useStyles();
  const { colors } = useTheme();
  const group = useGroupSend(roomId);
  const room = useDesktopRoom(roomId, group.pending);
  const { profiles, call, showToast } = useGateway();
  const roster = useMemo(() => rosterFromProfiles(profiles), [profiles]);
  const tagFor = useCallback((profile: string) => botMentionTag(roster.find((r) => r.name === profile) ?? { name: profile }), [roster]);
  const [newTopic, setNewTopic] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const displayName = useCallback(
    (profile: string) => botTitle(profiles.find((p) => p.name === profile), profile),
    [profiles],
  );
  const [membersOpen, setMembersOpen] = useState(false);
  const listRef = useRef<FlatList<TimelineRow>>(null);
  // Newest-first data in an inverted list (the 1:1 chat layout): offset 0 is the latest message, so
  // opening lands there however tall the history is, with no measure-then-scroll-to-end guess.
  // Pinned while at the bottom; only the reader's own drags move it away.
  const pinned = useRef(true);
  const [away, setAway] = useState<{ rows: number } | null>(null);
  const newestFirst = useMemo(() => [...room.rows].reverse(), [room.rows]);

  const back = useCallback(() => (router.canGoBack() ? router.back() : router.replace("/")), []);
  const openMembers = useCallback(() => setMembersOpen(true), []);
  const closeMembers = useCallback(() => setMembersOpen(false), []);

  const toLatest = useCallback((animated: boolean) => {
    pinned.current = true;
    setAway(null);
    listRef.current?.scrollToOffset({ offset: 0, animated });
  }, []);

  const rowCount = room.rows.length;
  const settle = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      pinned.current = event.nativeEvent.contentOffset.y < NEAR_BOTTOM_PX;
      setAway(pinned.current ? null : (prev) => prev ?? { rows: rowCount });
    },
    [rowCount],
  );

  // Late-sizing rows (full texts resolving, images) must not leave a pinned reader above the newest.
  const onContentSizeChange = useCallback(() => {
    if (pinned.current) listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, []);

  // Reply to one message: quote it and address its author, so that bot answers it.
  const [replyTo, setReplyTo] = useState<{ entry: MirrorEntry; text: string } | null>(null);
  const reply = useCallback((entry: MirrorEntry, text: string) => setReplyTo({ entry, text }), []);
  const renderItem = useCallback(
    ({ item }: { item: TimelineRow }) => <RoomRow row={item} displayName={displayName} onReply={reply} />,
    [displayName, reply],
  );
  const keyExtractor = useCallback((item: TimelineRow) => item.key, []);

  const members = useMemo(() => room.room?.members ?? [], [room.room]);
  const latestThread = useMemo(() => latestThreadOf(room.room?.log), [room.room]);
  const { send } = group;
  const onSend = useCallback(
    (text: string) => {
      toLatest(true);
      setNewTopic(false);
      let body = text;
      if (replyTo) {
        const quote = replyTo.text.replace(/\s+/g, " ").trim().slice(0, 280);
        const who = replyTo.entry.from.kind === "member" ? tagFor(replyTo.entry.from.name) : "";
        const mention = who && !new RegExp(`@${who}\\b`, "i").test(text) ? `@${who} ` : "";
        body = `> ${quote}${replyTo.text.length > 280 ? "…" : ""}\n\n${mention}${text}`;
        setReplyTo(null);
      }
      void send(body, newTopic || !latestThread ? null : latestThread.id);
    },
    [send, newTopic, latestThread, replyTo, tagFor, toLatest],
  );
  const held = useMemo(
    () => heldMemberNames(room.room?.log ?? [], members, roster),
    [room.room, members, roster],
  );
  const hold = useCallback(
    (member: MirrorMember, pause: boolean) => {
      toLatest(true);
      void send(holdText(tagFor(member.name), pause), latestThread?.id ?? null);
    },
    [send, tagFor, latestThread, toLatest],
  );
  const manage = useMemo(
    () => ({
      rename: async (name: string) => {
        const result = await renameDesktopRoom(call, roomId, name);
        showToast(`Renamed to ${result.name}`, "success");
        room.refresh();
      },
      setMembers: async (names: string[]) => {
        await setDesktopRoomMembers(call, roomId, names, tagFor);
        room.refresh();
      },
      remove: async () => {
        await disbandDesktopRoom(call, roomId);
        showToast("Group deleted", "success");
        setMembersOpen(false);
        back();
      },
    }),
    [back, call, room, roomId, showToast, tagFor],
  );
  const toggleNewTopic = useCallback(() => setNewTopic((v) => !v), []);
  const title = room.room?.name ?? (room.loading ? "Loading…" : "Group chat");
  const pausedNames = members.filter((m) => held.has(m.name)).map((m) => displayName(m.name));
  const subtitle = room.room
    ? pausedNames.length
      ? `${members.length} bot${members.length === 1 ? "" : "s"} · ${pausedNames.join(", ")} paused`
      : `${members.length} bot${members.length === 1 ? "" : "s"} · Hermes desktop group`
    : undefined;

  const header = (
    <LoadEarlier omitted={room.omitted} state={room.earlierState} found={room.earlierCount} onPress={room.loadEarlier} />
  );

  let body: React.ReactNode;
  if (room.loading) {
    body = <RoomSkeleton />;
  } else if (!room.room && room.error) {
    body = (
      <View style={styles.center}>
        <EmptyState
          icon="cloud-offline-outline"
          title="Couldn't load this group"
          body={room.error}
          action={<Button title="Retry" icon="refresh" variant="secondary" onPress={room.retry} style={styles.action} />}
        />
      </View>
    );
  } else if (room.notFound) {
    body = (
      <View style={styles.center}>
        <EmptyState
          icon="chatbubbles-outline"
          title="Group not found"
          body="This group may have been deleted in the Hermes desktop app."
          action={<Button title="Go back" variant="secondary" onPress={back} style={styles.action} />}
        />
      </View>
    );
  } else {
    body = (
      <FlatList
        ref={listRef}
        inverted
        data={newestFirst}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        // Inverted: the footer sits at the top, above the oldest message.
        ListFooterComponent={room.rows.length ? header : null}
        ListEmptyComponent={
          <View style={styles.center}>
            <EmptyState icon="chatbubbles-outline" title="No messages yet" body="Messages sent in the Hermes desktop app will show up here." />
          </View>
        }
        contentContainerStyle={[styles.content, !room.rows.length && styles.contentEmpty]}
        onScrollEndDrag={settle}
        onMomentumScrollEnd={settle}
        onContentSizeChange={onContentSizeChange}
        maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: 80 }}
        keyboardDismissMode="on-drag"
        removeClippedSubviews={false}
      />
    );
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScreenHeader
        title={title}
        subtitle={subtitle}
        onBack={back}
        right={
          room.room ? (
            <View style={styles.headerRight}>
              {members.length ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`Group members: ${members.map((m) => displayName(m.name)).join(", ")}`} onPress={openMembers} hitSlop={6}>
                  <MemberFacepile members={members} size={24} max={3} displayName={displayName} />
                </Pressable>
              ) : null}
              <IconButton icon="ellipsis-horizontal" label="Manage group" onPress={openMembers} />
            </View>
          ) : null
        }
      />
      <View style={styles.body}>
        {body}
        {away && room.room ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={room.rows.length > away.rows ? "New messages. Jump to latest" : "Jump to latest message"}
            onPress={() => toLatest(true)}
            style={({ pressed }) => [styles.jump, pressed && { opacity: 0.8 }]}
          >
            {room.rows.length > away.rows ? <Text style={styles.jumpText}>New messages</Text> : null}
            <Icon name="arrow-down" size={16} color={colors.text} />
          </Pressable>
        ) : null}
      </View>
      {group.requests.map((request) => (
        <RequestCard
          key={request.id}
          request={request}
          botName={displayName(group.progress?.member ?? "")}
          onAnswer={group.answer}
          onDecline={group.decline}
        />
      ))}
      {group.busy && group.progress ? <RoomProgress {...group.progress} displayName={displayName} /> : null}
      {room.room ? (
        <RoomComposer
          members={members}
          displayName={displayName}
          tagFor={tagFor}
          latestThread={latestThread}
          newTopic={newTopic}
          onToggleNewTopic={toggleNewTopic}
          busy={group.busy}
          onSend={onSend}
          onStop={group.stop}
          replyTo={
            replyTo
              ? {
                  label: `Replying to ${replyTo.entry.from.kind === "member" ? displayName(replyTo.entry.from.name) : "you"}: ${replyTo.text.replace(/\s+/g, " ").slice(0, 70)}`,
                  onCancel: () => setReplyTo(null),
                }
              : null
          }
          now={now}
        />
      ) : null}
      <RoomManageSheet
        visible={membersOpen}
        onClose={closeMembers}
        name={room.room?.name ?? ""}
        members={members}
        held={held}
        displayName={displayName}
        busy={group.busy}
        onRename={manage.rename}
        onSetMembers={manage.setMembers}
        onHold={hold}
        onDelete={manage.remove}
      />
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },
  jump: {
    position: "absolute",
    right: space.lg,
    bottom: space.md,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minWidth: 40,
    height: 40,
    paddingHorizontal: 12,
    borderRadius: 20,
    justifyContent: "center",
    backgroundColor: colors.scheme === "light" ? colors.bg : colors.overlay,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: colors.shadow,
    shadowOpacity: 1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  jumpText: { color: colors.text, fontSize: 13, fontWeight: "600" },
  headerRight: { flexDirection: "row", alignItems: "center", gap: space.xs, paddingRight: space.xs },
  // Inverted list: paddingTop is the visual bottom, above the composer.
  content: { paddingTop: space.lg },
  contentEmpty: { flexGrow: 1 },
  center: { flex: 1, justifyContent: "center" },
  action: { marginTop: space.md },
}));
