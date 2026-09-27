import React, { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Href, router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusPill } from "@/features/boards/BoardBits";
import { eventText, MOVE_TARGETS, statusLabel } from "@/features/boards/format";
import { useBoardActions, useTask } from "@/features/boards/useBoards";
import { useMarkdown } from "@/features/chat/messageStyles";
import { shortTime } from "@/features/inbox/format";
import { RichMessage } from "@/features/media/RichMessage";
import { BotChips } from "@/features/settings/BotChips";
import { useGateway } from "@/lib/store/GatewayProvider";
import { BotAvatar, Button, Chip, EmptyState, IconButton, ScreenHeader, SectionLabel, Sheet } from "@/ui/primitives";
import { makeStyles, radius, space, useTheme } from "@/ui/theme";

/** A task card in full: brief, latest result, thread, and the moves you can make on it. */
export default function TaskScreen() {
  const { slug, task: taskId } = useLocalSearchParams<{ slug: string; task: string }>();
  const styles = useStyles();
  const markdown = useMarkdown();
  const insets = useSafeAreaInsets();
  const { colors, type } = useTheme();
  const { profiles } = useGateway();
  const { data, error, reload, refresh } = useTask(slug, taskId);
  const actions = useBoardActions(slug);
  const [sheet, setSheet] = useState<"move" | "assign" | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [now] = useState(() => Date.now());
  const task = data?.task;

  const act = async (run: () => Promise<string | null>) => {
    setSheet(null);
    setBusy(true);
    await run();
    setBusy(false);
    void reload();
  };

  if (!task)
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Task" onBack={() => router.back()} />
        {error ? (
          <EmptyState icon="cloud-offline-outline" title="Couldn't load this task" body={error} action={<Button title="Try again" variant="secondary" onPress={refresh} />} />
        ) : (
          <ActivityIndicator style={{ marginTop: space.xxl }} color={colors.muted} />
        )}
      </View>
    );

  const owner = task.assignee ?? "default";
  const result = task.latest_summary || task.result;
  const history = (data?.events ?? []).filter((e) => e.kind !== "commented").slice(-6).reverse();

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScreenHeader
        title="Task"
        subtitle={`${task.id} · ${statusLabel(task.status)}`}
        onBack={() => router.back()}
        right={
          task.session_id ? (
            <IconButton
              icon="chatbubbles-outline"
              label="Open the worker's chat"
              onPress={() => router.push(`/chat/${encodeURIComponent(task.session_id!)}?profile=${encodeURIComponent(owner)}` as Href)}
            />
          ) : undefined
        }
      />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={type.title}>{task.title}</Text>
        <View style={styles.meta}>
          <StatusPill status={task.status} />
          {task.assignee ? <BotAvatar name={task.assignee} size={20} /> : null}
          <Text style={type.small}>{task.assignee ? `@${task.assignee}` : "Unassigned"}</Text>
          {task.created_at ? <Text style={type.small}>· {shortTime(task.created_at * 1000, now)}</Text> : null}
        </View>
        <View style={styles.row}>
          <Button title="Move" icon="swap-horizontal" variant="secondary" onPress={() => setSheet("move")} disabled={busy} style={styles.flex} />
          <Button title="Assign" icon="person-outline" variant="secondary" onPress={() => setSheet("assign")} disabled={busy} style={styles.flex} />
          {task.status === "review" ? (
            <Button title="Approve" icon="checkmark" onPress={() => act(() => actions.move(task, "done"))} disabled={busy} style={styles.flex} />
          ) : null}
        </View>

        {task.last_failure_error && task.status === "blocked" ? (
          <View style={[styles.card, { borderColor: colors.danger }]}>
            <Text style={[type.small, { color: colors.danger }]}>{task.last_failure_error}</Text>
          </View>
        ) : null}
        {result ? (
          <>
            <SectionLabel>LATEST RESULT</SectionLabel>
            <View style={styles.card}>
              <RichMessage text={result} profile={owner} markdownStyle={markdown} />
            </View>
          </>
        ) : null}
        {task.body ? (
          <>
            <SectionLabel>BRIEF</SectionLabel>
            <RichMessage text={task.body} profile={owner} markdownStyle={markdown} />
          </>
        ) : null}
        {data?.child_results?.length ? (
          <>
            <SectionLabel>SUBTASKS</SectionLabel>
            {data.child_results.map((child) => (
              <View key={child.id} style={styles.child}>
                <StatusPill status={child.status} />
                <Text style={[type.body, styles.flex]} numberOfLines={2}>
                  {child.title}
                </Text>
              </View>
            ))}
          </>
        ) : null}

        <SectionLabel>{`THREAD${data?.comments.length ? ` · ${data.comments.length}` : ""}`}</SectionLabel>
        {data?.comments.map((comment) => (
          <View key={comment.id} style={styles.comment}>
            <BotAvatar name={comment.author} size={24} />
            <View style={styles.flex}>
              <Text style={type.small}>
                <Text style={styles.author}>{comment.author}</Text> · {shortTime(comment.created_at * 1000, now)}
              </Text>
              <RichMessage text={comment.body} profile={owner} markdownStyle={markdown} />
            </View>
          </View>
        ))}
        {history.length ? (
          <>
            <SectionLabel>ACTIVITY</SectionLabel>
            {history.map((event) => (
              <Text key={event.id} style={type.small}>
                {shortTime(event.created_at * 1000, now)} · {eventText(event)}
              </Text>
            ))}
          </>
        ) : null}
      </ScrollView>
      <View style={[styles.replyBar, { paddingBottom: Math.max(insets.bottom, space.sm) }]}>
        <TextInput
          value={reply}
          onChangeText={setReply}
          placeholder="Comment for the bots on this task"
          placeholderTextColor={colors.faint}
          style={styles.replyInput}
          multiline
          accessibilityLabel="Comment"
        />
        <IconButton
          icon="arrow-up"
          label="Post comment"
          filled
          onPress={() => {
            const text = reply.trim();
            if (!text) return;
            setReply("");
            void act(() => actions.comment(task, text));
          }}
        />
      </View>

      <Sheet visible={sheet === "move"} onClose={() => setSheet(null)} title="Move to">
        <View style={styles.chips}>
          {MOVE_TARGETS.filter((s) => s !== task.status).map((status) => (
            <Chip key={status} label={statusLabel(status)} onPress={() => act(() => actions.move(task, status))} />
          ))}
        </View>
      </Sheet>
      <Sheet visible={sheet === "assign"} onClose={() => setSheet(null)} title="Assign to">
        <View style={styles.assign}>
          <BotChips
            profiles={profiles}
            value={task.assignee ?? null}
            onChange={(name) => act(() => actions.assign(task, name))}
            leading={<Chip label="Nobody" active={!task.assignee} onPress={() => act(() => actions.assign(task, null))} />}
          />
        </View>
      </Sheet>
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  meta: { flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" },
  row: { flexDirection: "row", gap: space.sm },
  flex: { flex: 1 },
  card: {
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  child: { flexDirection: "row", alignItems: "center", gap: space.sm },
  comment: { flexDirection: "row", gap: space.sm, alignItems: "flex-start" },
  author: { fontWeight: "600", color: colors.text },
  replyBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  replyInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    color: colors.text,
    fontSize: 15,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, padding: space.lg },
  assign: { paddingVertical: space.lg },
}));
