import React, { memo } from "react";
import { Pressable, Text, View } from "react-native";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import type { ProfileRow, SessionListRow } from "@/lib/gateway/types";
import { botTitle } from "@/features/chat/botMeta";
import { BotAvatar, haptic, Icon, IconName } from "@/ui/primitives";
import { makeStyles, space, useTheme } from "@/ui/theme";
import { previewText, readableInk, shortTime, toMs } from "./format";
import { RowSeparator } from "./InboxRows";

export const SESSION_AVATAR = 36;
const ACTION_WIDTH = 88;

const SOURCE_ICONS: Record<string, IconName> = {
  discord: "logo-discord",
  telegram: "paper-plane-outline",
  slack: "logo-slack",
  cron: "alarm-outline",
  desktop: "desktop-outline",
  tui: "terminal-outline",
  cli: "terminal-outline",
  mobile: "phone-portrait-outline",
  kanban: "albums-outline",
  subagent: "git-branch-outline",
  webhook: "link-outline",
};

function DeleteAction({ onPress }: { onPress: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const ink = readableInk(colors.danger);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Delete session" onPress={onPress} style={styles.action}>
      <Icon name="trash-outline" size={20} color={ink} />
      <Text style={[styles.actionText, { color: ink }]}>Delete</Text>
    </Pressable>
  );
}

export const SessionRow = memo(function SessionRow({
  row,
  bot,
  now,
  separator,
  onPress,
  onLongPress,
  onDelete,
}: {
  row: SessionListRow;
  bot: ProfileRow | undefined;
  now: number;
  separator: boolean;
  onPress: (row: SessionListRow) => void;
  onLongPress: (row: SessionListRow) => void;
  /** Asks to delete; `close` snaps the swipe shut if the person cancels. */
  onDelete: (row: SessionListRow, close: () => void) => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const profile = row.profile ?? "default";
  const source = row.source ?? "";
  const title = row.title || previewText(row.preview) || "Untitled session";
  const unread = Boolean(row.unread);
  return (
    <ReanimatedSwipeable
      friction={2}
      rightThreshold={ACTION_WIDTH / 2}
      overshootRight={false}
      renderRightActions={(_progress, _translation, methods) => <DeleteAction onPress={() => onDelete(row, methods.close)} />}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${unread ? "Unread. " : ""}${title}, with ${botTitle(bot, profile)}`}
        accessibilityHint="Long press for rename and delete"
        accessibilityActions={[
          { name: "delete", label: "Delete" },
          { name: "longpress", label: "More actions" },
        ]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === "delete") onDelete(row, () => undefined);
          else onLongPress(row);
        }}
        onPress={() => onPress(row)}
        onLongPress={() => {
          haptic.press();
          onLongPress(row);
        }}
        delayLongPress={350}
        style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.raised : colors.bg }]}
      >
        <BotAvatar name={profile} size={SESSION_AVATAR} />
        <View style={styles.copy}>
          <View style={styles.line}>
            {unread ? <View style={styles.unread} /> : null}
            <Text style={[styles.title, unread && styles.titleUnread]} numberOfLines={1}>
              {title}
            </Text>
            {row.is_active ? <View style={styles.live} accessibilityLabel="Live" /> : null}
            {row.pinned ? <Icon name="pin" size={12} color={colors.faint} /> : null}
            <Text style={styles.time}>{shortTime(toMs(row.last_active ?? row.started_at), now)}</Text>
          </View>
          <View style={styles.meta}>
            {SOURCE_ICONS[source] ? <Icon name={SOURCE_ICONS[source]} size={12} color={colors.faint} /> : null}
            <Text style={styles.metaText} numberOfLines={1}>
              {botTitle(bot, profile)}
              {source ? ` · ${source}` : ""}
              {row.message_count ? ` · ${row.message_count} msgs` : ""}
            </Text>
          </View>
          {row.preview && row.title ? (
            <Text style={styles.preview} numberOfLines={1}>
              {previewText(row.preview)}
            </Text>
          ) : null}
        </View>
        {separator ? <RowSeparator avatar={SESSION_AVATAR} /> : null}
      </Pressable>
    </ReanimatedSwipeable>
  );
});

const useStyles = makeStyles((colors) => ({
  row: { flexDirection: "row", alignItems: "flex-start", gap: space.md, paddingHorizontal: space.lg, paddingVertical: 11 },
  copy: { flex: 1, minWidth: 0, gap: 3 },
  line: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { flexShrink: 1, color: colors.text, fontSize: 16, fontWeight: "600" },
  titleUnread: { fontWeight: "700" },
  unread: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
  time: { marginLeft: "auto", color: colors.faint, fontSize: 13, fontVariant: ["tabular-nums"] },
  preview: { color: colors.muted, fontSize: 14, lineHeight: 19 },
  meta: { flexDirection: "row", alignItems: "center", gap: 5 },
  metaText: { color: colors.faint, fontSize: 12, flexShrink: 1 },
  live: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success },
  action: { width: ACTION_WIDTH, alignItems: "center", justifyContent: "center", gap: 4, backgroundColor: colors.danger },
  actionText: { fontSize: 13, fontWeight: "600" },
}));
