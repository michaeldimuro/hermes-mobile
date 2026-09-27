import React, { memo, useContext, useState } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { useGateway } from "@/lib/store/GatewayProvider";
import type { ProfileRow } from "@/lib/gateway/types";
import { RichMessage } from "@/features/media/RichMessage";
import { BotAvatar, haptic, Icon } from "@/ui/primitives";
import { EASE_OUT } from "@/ui/motion";
import { botColor, makeStyles, radius, space, useTheme } from "@/ui/theme";
import { botTitle } from "./botMeta";
import type { Inbound } from "./inbound";
import { botHandle } from "./mentions";
import { ChatScope, useMarkdown } from "./messageStyles";

const REVEAL = FadeIn.duration(150).easing(EASE_OUT);
/** Teammate messages longer than this start collapsed; the thread stays scannable. */
const LONG = 700;

const profileFor = (profiles: ProfileRow[], handle?: string) =>
  handle ? profiles.find((bot) => bot.name === handle || botHandle(bot) === handle) : undefined;

/** A message another bot sent into this chat: shown as theirs, not as the user's bubble. */
function AgentMessage({ inbound }: { inbound: Extract<Inbound, { kind: "agent" }> }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const markdown = useMarkdown();
  const scope = useContext(ChatScope);
  const { profiles } = useGateway();
  const bot = profileFor(profiles, inbound.handle);
  const id = bot?.name ?? inbound.handle;
  const long = inbound.text.length > LONG;
  const [open, setOpen] = useState(!long);
  return (
    <View style={styles.agentRow} accessibilityLabel={`Message from ${inbound.name}`}>
      <BotAvatar name={id} size={28} />
      <View style={styles.agentColumn}>
        <Text style={[styles.agentName, { color: botColor(id, colors) }]}>{bot ? botTitle(bot) : inbound.name}</Text>
        <View style={[styles.agentBubble, !open && styles.collapsed]}>
          <RichMessage text={inbound.text} profile={bot?.name ?? scope.profile} markdownStyle={markdown} />
        </View>
        {long ? (
          <Pressable accessibilityRole="button" onPress={() => setOpen((value) => !value)} hitSlop={8}>
            <Text style={styles.more}>{open ? "Show less" : "Show more"}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/** Task updates and background-process notices: one quiet line, details on tap. */
function EventRow({ inbound }: { inbound: Exclude<Inbound, { kind: "agent" }> }) {
  const styles = useStyles();
  const { colors, type } = useTheme();
  const markdown = useMarkdown();
  const scope = useContext(ChatScope);
  const { profiles } = useGateway();
  const [open, setOpen] = useState(false);
  const task = inbound.kind === "task";
  const bot = task ? profileFor(profiles, inbound.handle) : undefined;
  const title = task ? inbound.title : inbound.summary;
  const tint = inbound.ok ? colors.success : colors.danger;
  return (
    <View style={styles.event}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${task ? (inbound.ok ? "Task done" : "Task update") : "Process"}: ${title}`}
        onPress={() => {
          haptic.tap();
          setOpen((value) => !value);
        }}
        style={styles.eventHead}
      >
        <Icon
          name={task ? (inbound.ok ? "checkmark-circle" : "alert-circle") : inbound.ok ? "terminal-outline" : "alert-circle"}
          size={16}
          color={task || !inbound.ok ? tint : colors.muted}
        />
        {bot ? <BotAvatar name={bot.name} size={18} /> : null}
        <Text style={styles.eventTitle} numberOfLines={open ? undefined : 1}>
          {title}
        </Text>
        <Icon name={open ? "chevron-up" : "chevron-down"} size={14} color={colors.faint} />
      </Pressable>
      {open && inbound.detail ? (
        <Animated.View entering={REVEAL} style={styles.eventBody}>
          {task ? (
            <RichMessage text={inbound.detail} profile={bot?.name ?? scope.profile} markdownStyle={markdown} />
          ) : (
            <Text selectable style={[type.mono, styles.processText]} numberOfLines={24}>
              {inbound.detail}
            </Text>
          )}
        </Animated.View>
      ) : null}
    </View>
  );
}

export const InboundItemView = memo(function InboundItemView({ inbound }: { inbound: Inbound }) {
  return inbound.kind === "agent" ? <AgentMessage inbound={inbound} /> : <EventRow inbound={inbound} />;
});

const useStyles = makeStyles((colors) => ({
  agentRow: { flexDirection: "row", gap: space.sm, alignItems: "flex-start", marginVertical: space.sm, paddingRight: 32 },
  agentColumn: { flex: 1, minWidth: 0, gap: 4 },
  agentName: { fontSize: 13, fontWeight: "600" },
  agentBubble: {
    alignSelf: "flex-start",
    maxWidth: "100%",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.lg,
    borderTopLeftRadius: 6,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  collapsed: { maxHeight: 220, overflow: "hidden" },
  more: { color: colors.accentText, fontSize: 13, fontWeight: "600", paddingVertical: 2 },
  event: {
    marginVertical: space.xs,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  eventHead: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md, paddingVertical: 10 },
  eventTitle: { flex: 1, color: colors.textSoft, fontSize: 14, fontWeight: "500" },
  eventBody: { paddingHorizontal: space.md, paddingBottom: space.md },
  processText: { color: colors.textSoft, fontSize: 12, lineHeight: 17 },
}));
