import React, { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { ProfileRow } from "@/lib/gateway/types";
import { BotAvatar, haptic, Icon, IconName, PressScale } from "@/ui/primitives";
import { makeStyles, radius, space, useTheme } from "@/ui/theme";
import { botTitle } from "./botMeta";
import Animated, { FadeInDown } from "react-native-reanimated";
import { EASE_OUT } from "@/ui/motion";

/** New-chat starters settle in one after another (50ms apart) — an occasional, welcoming moment. */
const HERO_CARDS = [0, 1, 2, 3].map((index) =>
  FadeInDown.delay(80 + index * 50)
    .duration(250)
    .easing(EASE_OUT),
);

type Prompt = { icon: IconName; title: string; prompt: string };

/** Role-aware starters: bots are matched by name/description so suggestions fit their job. */
const ROLE_PROMPTS: [RegExp, Prompt[]][] = [
  [
    /research/i,
    [
      {
        icon: "search-outline",
        title: "Research a topic",
        prompt: "Research the latest developments on ",
      },
      {
        icon: "newspaper-outline",
        title: "Summarize the news",
        prompt: "Give me a sourced briefing on today's top stories in ",
      },
    ],
  ],
  [
    /review|qa|test/i,
    [
      {
        icon: "checkmark-done-outline",
        title: "Review a change",
        prompt: "Review the most recent changes in ",
      },
      {
        icon: "bug-outline",
        title: "Design test cases",
        prompt: "Design a test plan for ",
      },
    ],
  ],
  [
    /secur/i,
    [
      {
        icon: "shield-outline",
        title: "Threat model",
        prompt: "Threat-model this feature: ",
      },
      {
        icon: "lock-closed-outline",
        title: "Audit dependencies",
        prompt: "Audit the dependencies of ",
      },
    ],
  ],
  [
    /architect|cto|engineer|backend|frontend|mobile|devops/i,
    [
      {
        icon: "construct-outline",
        title: "Plan a feature",
        prompt: "Plan the implementation of ",
      },
      {
        icon: "git-pull-request-outline",
        title: "Explain the codebase",
        prompt: "Explain how this project is structured: ",
      },
    ],
  ],
  [
    /orchestr|default|xandus|ceo/i,
    [
      {
        icon: "people-outline",
        title: "Delegate a project",
        prompt: "Break this down and delegate to the right bots: ",
      },
      {
        icon: "albums-outline",
        title: "Check my boards",
        prompt: "What's in progress across my Kanban boards?",
      },
    ],
  ],
  [
    /doc|content|social|cmo|growth/i,
    [
      { icon: "create-outline", title: "Draft something", prompt: "Draft a " },
      {
        icon: "megaphone-outline",
        title: "Write a post",
        prompt: "Write a short post announcing ",
      },
    ],
  ],
];

const GENERAL: Prompt[] = [
  {
    icon: "sunny-outline",
    title: "Plan my day",
    prompt: "Plan my day based on my calendar and open tasks.",
  },
  {
    icon: "alarm-outline",
    title: "Automate something",
    prompt: "Set up a recurring automation that ",
  },
  {
    icon: "sparkles-outline",
    title: "What can you do?",
    prompt: "What skills and tools do you have, and what are you best at?",
  },
];

function greeting() {
  const hour = new Date().getHours();
  return hour < 5
    ? "Up late"
    : hour < 12
      ? "Good morning"
      : hour < 18
        ? "Good afternoon"
        : "Good evening";
}

export function HomeHero({
  bot,
  onPrompt,
}: {
  bot: ProfileRow | undefined;
  onPrompt: (text: string) => void;
}) {
  const styles = useStyles();
  const { colors, type } = useTheme();
  const name = bot ? botTitle(bot) : "Hermes";
  const prompts = useMemo(() => {
    const haystack = `${bot?.name ?? ""} ${bot?.description ?? ""}`;
    const role = ROLE_PROMPTS.filter(([re]) => re.test(haystack)).flatMap(
      ([, list]) => list,
    );
    return [...role, ...GENERAL].slice(0, 4);
  }, [bot]);

  return (
    <ScrollView
      contentContainerStyle={styles.wrap}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      <BotAvatar name={bot?.name ?? "default"} size={64} ring />
      <Text style={[type.display, styles.center, { marginTop: space.lg }]}>
        {greeting()}
      </Text>
      <Text style={[styles.sub, styles.center]}>
        {name}
        {bot?.description ? ` · ${bot.description}` : " is ready"}
      </Text>
      {bot?.model ? (
        <View style={styles.modelPill}>
          <Icon name="hardware-chip-outline" size={13} color={colors.muted} />
          <Text style={type.small}>{bot.model}</Text>
        </View>
      ) : null}
      <View style={styles.grid}>
        {prompts.map((prompt, index) => (
          <Animated.View
            key={prompt.title}
            entering={HERO_CARDS[index] ?? HERO_CARDS[0]}
            style={styles.cell}
          >
            <PressScale
              accessibilityRole="button"
              onPress={() => {
                haptic.tap();
                onPrompt(prompt.prompt);
              }}
              style={styles.card}
            >
              <Icon name={prompt.icon} size={18} color={colors.accentText} />
              <Text style={styles.cardTitle}>{prompt.title}</Text>
            </PressScale>
          </Animated.View>
        ))}
      </View>
    </ScrollView>
  );
}

const useStyles = makeStyles((colors, type) => ({
  wrap: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: space.xl,
    paddingBottom: space.xxl,
  },
  center: { textAlign: "center" },
  sub: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 21,
    marginTop: space.sm,
    maxWidth: 340,
  },
  modelPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: space.md,
    paddingHorizontal: space.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.sm,
    marginTop: space.xxl,
    justifyContent: "center",
    maxWidth: 520,
  },
  card: {
    width: "100%",
    minHeight: 84,
    padding: space.md,
    gap: space.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  cell: { width: "47%" },
  cardTitle: {
    color: colors.textSoft,
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 19,
  },
}));
