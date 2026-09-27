import React, {
  memo,
  useContext,
  useMemo,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { Icon, IconButton, haptic } from "@/ui/primitives";
import { makeStyles, radius, space, useTheme } from "@/ui/theme";
import type {
  AssistantItem,
  NoticeItem,
  SideItem,
  TimelineItem,
  UserItem,
} from "./chatReducer";
import Animated from "react-native-reanimated";
import { MESSAGE_IN } from "@/ui/motion";
import { InboundItemView } from "./InboundItem";
import { ChatScope, MessageActionsContext, useMarkdown } from "./messageStyles";
import { ThinkingBlock } from "./ThinkingBlock";
import { isLeaseError, LeaseNotice } from "./LeaseNotice";
import { AttachmentCard } from "@/features/media/AttachmentCard";
import { detectAttachments } from "@/features/media/detect";
import { RichMessage } from "@/features/media/RichMessage";

export { ChatScope, MessageActionsContext } from "./messageStyles";

function UserMessage({ item }: { item: UserItem }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { onEdit } = useContext(MessageActionsContext);
  const menu = () => {
    haptic.press();
    Alert.alert("Your message", undefined, [
      {
        text: "Copy",
        onPress: () => void Clipboard.setStringAsync(item.text).then(() => haptic.success()),
      },
      ...(onEdit ? [{ text: "Edit & resend", onPress: () => onEdit(item) }] : []),
      { text: "Cancel", style: "cancel" as const },
    ]);
  };
  return (
    <Pressable
      style={styles.userRow}
      onLongPress={menu}
      delayLongPress={350}
      accessibilityHint={onEdit ? "Long-press to copy or edit and resend" : "Long-press to copy"}
    >
      {item.images?.length ? (
        <View style={styles.images}>
          {item.images.map((uri) => (
            <Image key={uri} source={{ uri }} style={styles.image} />
          ))}
        </View>
      ) : null}
      {item.files?.length ? (
        <View style={styles.images}>
          {item.files.map((name) => (
            <View key={name} style={styles.sentFile}>
              <Icon name="document-text-outline" size={14} color={colors.textSoft} />
              <Text style={styles.sentFileName} numberOfLines={1}>
                {name}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      <View style={styles.userBubble}>
        <Text style={styles.userText}>{item.text}</Text>
      </View>
    </Pressable>
  );
}

/** Tool-produced files not already shown by the reply text itself. */
function ToolFiles({ item }: { item: AssistantItem }) {
  const scope = useContext(ChatScope);
  const styles = useStyles();
  const shown = useMemo(
    () =>
      new Set(detectAttachments(item.text).attachments.map((file) => file.key)),
    [item.text],
  );
  const files = (item.files ?? []).filter((file) => !shown.has(file.key));
  if (!files.length) return null;
  return (
    <View style={styles.files}>
      {files.map((file) => (
        <AttachmentCard
          key={file.key}
          attachment={file}
          profile={scope.profile}
          sessionId={scope.sessionId}
          deferred={item.streaming}
        />
      ))}
    </View>
  );
}

function Cursor() {
  const styles = useStyles();
  return <View style={styles.cursor} />;
}

function AssistantMessage({
  item,
  statusLine,
  onRetry,
  latest,
}: {
  item: AssistantItem;
  statusLine?: string;
  onRetry?: () => void;
  /** Only the newest reply shows its action row; older ones offer the same via long-press. */
  latest?: boolean;
}) {
  const markdown = useMarkdown();
  const scope = useContext(ChatScope);
  const styles = useStyles();
  const { colors } = useTheme();
  const copy = async () => {
    await Clipboard.setStringAsync(item.text);
    haptic.success();
  };
  const share = () =>
    Share.share({ message: item.text }).catch(() => undefined);
  const { onAskAbout, onSpeak, speakingId } = useContext(MessageActionsContext);
  const speaking = speakingId === item.id;
  const menu = () => {
    haptic.press();
    Alert.alert("Reply", undefined, [
      { text: "Copy", onPress: () => void copy() },
      { text: "Share…", onPress: () => void share() },
      ...(onAskAbout ? [{ text: "Ask about this", onPress: () => onAskAbout(item.text) }] : []),
      ...(onSpeak ? [{ text: speaking ? "Stop reading" : "Read aloud", onPress: () => onSpeak(item.id, item.text) }] : []),
      { text: "Cancel", style: "cancel" },
    ]);
  };
  return (
    <Pressable
      style={styles.assistant}
      onLongPress={item.text && !item.streaming ? menu : undefined}
      delayLongPress={350}
      accessibilityHint={
        item.text && !item.streaming
          ? "Long-press for copy and share"
          : undefined
      }
    >
      <ThinkingBlock turn={item} statusLine={statusLine} />
      {item.text ? (
        <RichMessage
          text={item.text}
          profile={scope.profile}
          sessionId={scope.sessionId}
          markdownStyle={markdown}
          streaming={item.streaming}
        />
      ) : null}
      <ToolFiles item={item} />
      {item.streaming && item.text ? <Cursor /> : null}
      {item.status === "interrupted" ? (
        <Text style={styles.meta}>Stopped</Text>
      ) : null}
      {item.status === "error" ? (
        <View style={styles.errorBox}>
          <Icon name="alert-circle" size={16} color={colors.danger} />
          <Text style={styles.errorText}>
            {item.error || "The turn failed."}
          </Text>
        </View>
      ) : null}
      {item.warning ? <Text style={styles.meta}>{item.warning}</Text> : null}
      {!item.streaming && ((latest && item.text) || item.status === "error") ? (
        <View style={styles.actions}>
          {item.text ? (
            <IconButton
              icon="copy-outline"
              label="Copy reply"
              size={17}
              color={colors.muted}
              onPress={copy}
            />
          ) : null}
          {item.text ? (
            <IconButton
              icon="share-outline"
              label="Share reply"
              size={17}
              color={colors.muted}
              onPress={share}
            />
          ) : null}
          {item.text && onSpeak ? (
            <IconButton
              icon={speaking ? "stop-circle-outline" : "volume-medium-outline"}
              label={speaking ? "Stop reading" : "Read aloud"}
              size={17}
              color={speaking ? colors.accentText : colors.muted}
              onPress={() => onSpeak(item.id, item.text)}
            />
          ) : null}
          {onRetry ? (
            <IconButton
              icon="refresh"
              label="Retry"
              size={17}
              color={colors.muted}
              onPress={onRetry}
            />
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

function Notice({
  item,
  onNewChat,
}: {
  item: NoticeItem;
  onNewChat?: () => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  if (isLeaseError(item.text))
    return <LeaseNotice text={item.text} onNewChat={onNewChat} />;
  const tint =
    item.level === "error"
      ? colors.danger
      : item.level === "warn"
        ? colors.warn
        : colors.muted;
  return (
    <View style={styles.notice}>
      <Icon
        name={
          item.level === "info"
            ? "information-circle-outline"
            : "alert-circle-outline"
        }
        size={15}
        color={tint}
      />
      <Text style={[styles.noticeText, { color: tint }]}>{item.text}</Text>
    </View>
  );
}

function SideAnswer({ item }: { item: SideItem }) {
  const markdown = useMarkdown();
  const scope = useContext(ChatScope);
  const styles = useStyles();
  const { colors, type } = useTheme();
  return (
    <View style={styles.side}>
      <View style={styles.sideHeader}>
        <Icon
          name={item.mode === "btw" ? "chatbubbles-outline" : "rocket-outline"}
          size={14}
          color={colors.accentText}
        />
        <Text style={styles.sideLabel}>
          {item.mode === "btw" ? "Side question" : "Background task"}
        </Text>
        {item.pending ? (
          <ActivityIndicator
            size="small"
            color={colors.accentText}
            style={{ transform: [{ scale: 0.7 }] }}
          />
        ) : null}
      </View>
      <Text style={styles.sideQuestion}>{item.question}</Text>
      {item.text ? (
        <RichMessage
          text={item.text}
          profile={scope.profile}
          sessionId={scope.sessionId}
          markdownStyle={markdown}
          streaming={item.pending}
        />
      ) : (
        <Text style={type.small}>
          {item.pending ? "Working on it in parallel…" : "No answer"}
        </Text>
      )}
    </View>
  );
}

/** Only messages born moments ago animate in — rows remounted by list virtualization never replay. */
const FRESH_MS = 1200;
const bornAt = (item: TimelineItem) =>
  item.kind === "user"
    ? item.createdAt
    : item.kind === "assistant"
      ? item.startedAt
      : undefined;

export const MessageItem = memo(function MessageItem(props: {
  item: TimelineItem;
  statusLine?: string;
  onRetry?: () => void;
  onNewChat?: () => void;
  latest?: boolean;
}) {
  const [fresh] = useState(() => {
    const at = bornAt(props.item);
    return Boolean(at && Date.now() - at < FRESH_MS);
  });
  if (!fresh) return <MessageBody {...props} />;
  return (
    <Animated.View entering={MESSAGE_IN}>
      <MessageBody {...props} />
    </Animated.View>
  );
});

function MessageBody({
  item,
  statusLine,
  onRetry,
  onNewChat,
  latest,
}: {
  item: TimelineItem;
  statusLine?: string;
  onRetry?: () => void;
  /** Offered when this conversation can't be posted to from here (held by Hermes desktop). */
  onNewChat?: () => void;
  latest?: boolean;
}) {
  switch (item.kind) {
    case "user":
      return <UserMessage item={item} />;
    case "assistant":
      return isLeaseError(item.error) ? (
        <LeaseNotice text={item.error ?? ""} onNewChat={onNewChat} />
      ) : (
        <AssistantMessage
          item={item}
          statusLine={statusLine}
          onRetry={onRetry}
          latest={latest}
        />
      );
    case "notice":
      return <Notice item={item} onNewChat={onNewChat} />;
    case "side":
      return <SideAnswer item={item} />;
    case "inbound":
      return <InboundItemView inbound={item.inbound} />;
  }
}



const useStyles = makeStyles((colors, type) => ({
  userRow: {
    alignItems: "flex-end",
    paddingLeft: 48,
    marginVertical: space.sm,
  },
  sentFile: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: 220,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.md,
    backgroundColor: colors.raised,
  },
  sentFileName: { color: colors.textSoft, fontSize: 13, flexShrink: 1 },
  userBubble: {
    backgroundColor: colors.userBubble,
    borderRadius: radius.lg,
    borderBottomRightRadius: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    // Never wider than the row: long unbroken tokens (paths, URLs) wrap instead of clipping.
    maxWidth: "100%",
    flexShrink: 1,
  },
  userText: { color: colors.text, fontSize: 16, lineHeight: 23, flexShrink: 1 },
  images: {
    flexDirection: "row",
    gap: space.xs,
    marginBottom: space.xs,
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  image: {
    width: 120,
    height: 120,
    borderRadius: radius.md,
    backgroundColor: colors.raised,
  },
  assistant: { marginVertical: space.sm },
  cursor: {
    width: 9,
    height: 18,
    backgroundColor: colors.accent,
    borderRadius: 2,
    marginTop: -6,
    opacity: 0.8,
  },
  meta: { ...type.small, marginTop: space.xs },
  errorBox: {
    flexDirection: "row",
    gap: space.sm,
    alignItems: "flex-start",
    backgroundColor: colors.dangerBg,
    borderRadius: radius.md,
    padding: space.md,
    marginTop: space.xs,
  },
  errorText: { color: colors.danger, fontSize: 14, flex: 1, lineHeight: 20 },
  actions: { flexDirection: "row", marginLeft: -10, marginTop: -4 },
  files: { gap: space.sm, marginTop: space.xs, marginBottom: space.xs },
  notice: {
    flexDirection: "row",
    gap: space.sm,
    alignItems: "center",
    justifyContent: "center",
    marginVertical: space.sm,
    paddingHorizontal: space.lg,
  },
  noticeText: { fontSize: 13, textAlign: "center", flexShrink: 1 },
  side: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    padding: space.md,
    marginVertical: space.sm,
    gap: space.xs,
  },
  sideHeader: { flexDirection: "row", gap: space.sm, alignItems: "center" },
  sideLabel: {
    color: colors.accentText,
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  sideQuestion: {
    color: colors.textSoft,
    fontSize: 14,
    fontStyle: "italic",
    marginBottom: space.xs,
  },
}));
