import React, { useMemo } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { useGateway } from "@/lib/store/GatewayProvider";
import type { ProfileRow } from "@/lib/gateway/types";
import { BotAvatar, haptic, Icon } from "@/ui/primitives";
import { makeStyles, radius, space, useTheme } from "@/ui/theme";
import { botTitle } from "./botMeta";
import { rankMatches, Trigger } from "./composerText";
import { botHandle, botModeTitle } from "./mentions";
import { SlashEntry, useSlashCatalog } from "./useSlashCatalog";

type Row =
  | { type: "header"; key: string; label: string }
  | { type: "slash"; key: string; entry: SlashEntry }
  | { type: "bot"; key: string; bot: ProfileRow };

const MAX_PER_SECTION = 60;

/**
 * Inline picker above the composer: `/` lists the skills this bot can run (then Hermes commands),
 * `@` lists the bots you can mention. Filters as you type; tap to insert.
 */
export function SuggestionPanel({
  trigger,
  profile,
  onPick,
}: {
  trigger: Trigger | null;
  profile: string;
  onPick: (insert: string) => void;
}) {
  const styles = useStyles();
  const { colors, type } = useTheme();
  const { profiles } = useGateway();
  const slash = trigger?.kind === "/";
  const { catalog, loading } = useSlashCatalog(profile, slash);
  const bot = profiles.find((row) => row.name === profile);

  const rows = useMemo<Row[]>(() => {
    if (!trigger) return [];
    if (trigger.kind === "@") {
      const bots = profiles.filter((row) => row.role !== "setup" && row.name !== profile);
      return rankMatches(bots, trigger.query, (row) => [botHandle(row), botModeTitle(row), row.name, row.description ?? ""]).map((row) => ({
        type: "bot",
        key: `bot:${row.name}`,
        bot: row,
      }));
    }
    if (!catalog) return [];
    const fields = (entry: SlashEntry) => [entry.name, entry.description, entry.category ?? ""];
    const allSkills = rankMatches(catalog.skills, trigger.query, fields);
    const skills = allSkills.slice(0, MAX_PER_SECTION);
    const commands = rankMatches(catalog.commands, trigger.query, fields).slice(0, MAX_PER_SECTION);
    const out: Row[] = [];
    if (skills.length) {
      const more = allSkills.length > skills.length ? ` (type to narrow)` : "";
      out.push({ type: "header", key: "h:skills", label: `Skills ${botTitle(bot, profile)} can run · ${allSkills.length}${more}` });
      skills.forEach((entry) => out.push({ type: "slash", key: `s:${entry.name}`, entry }));
    }
    if (commands.length) {
      out.push({ type: "header", key: "h:commands", label: "Hermes commands" });
      commands.forEach((entry) => out.push({ type: "slash", key: `c:${entry.name}`, entry }));
    }
    return out;
  }, [bot, catalog, profile, profiles, trigger]);

  if (!trigger) return null;
  const empty = !rows.length;
  if (empty && !loading && trigger.kind === "@" && !trigger.query) return null;

  return (
    <View style={styles.panel} accessibilityRole="menu">
      {loading ? (
        <View style={styles.status}>
          <ActivityIndicator size="small" color={colors.muted} />
          <Text style={type.small}>Loading skills…</Text>
        </View>
      ) : empty ? (
        <View style={styles.status}>
          <Text style={type.small}>
            {trigger.kind === "/" ? `No skills or commands match “${trigger.query}”` : `No bots match “${trigger.query}”`}
          </Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row) => row.key}
          keyboardShouldPersistTaps="always"
          initialNumToRender={12}
          renderItem={({ item }) => {
            if (item.type === "header") return <Text style={styles.header}>{item.label}</Text>;
            if (item.type === "bot") {
              const title = botTitle(item.bot);
              const handle = botHandle(item.bot);
              return (
                <Pressable
                  accessibilityRole="menuitem"
                  accessibilityLabel={`Mention ${title}`}
                  onPress={() => {
                    haptic.tap();
                    onPick(`@${handle}`);
                  }}
                  style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.raised }]}
                >
                  <BotAvatar name={item.bot.name} size={30} />
                  <View style={styles.copy}>
                    <Text style={styles.name} numberOfLines={1}>
                      {title} <Text style={styles.handle}>@{handle}</Text>
                    </Text>
                    {item.bot.description ? (
                      <Text style={type.small} numberOfLines={1}>
                        {item.bot.description}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            }
            const { entry } = item;
            return (
              <Pressable
                accessibilityRole="menuitem"
                accessibilityLabel={`${entry.kind === "skill" ? "Run skill" : "Command"} ${entry.name}`}
                onPress={() => {
                  haptic.tap();
                  onPick(`/${entry.name}`);
                }}
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.raised }]}
              >
                <View style={[styles.badge, entry.kind === "skill" && styles.skillBadge]}>
                  <Icon
                    name={entry.kind === "skill" ? "flash" : "code-slash"}
                    size={13}
                    color={entry.kind === "skill" ? colors.accentText : colors.muted}
                  />
                </View>
                <View style={styles.copy}>
                  <Text style={styles.name} numberOfLines={1}>
                    /{entry.name}
                    {entry.category ? <Text style={styles.category}>{`  ${entry.category}`}</Text> : null}
                  </Text>
                  {entry.description ? (
                    <Text style={type.small} numberOfLines={2}>
                      {entry.description}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const useStyles = makeStyles((colors, type) => ({
  panel: {
    maxHeight: 300,
    marginBottom: space.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.scheme === "light" ? colors.bg : colors.surface,
    overflow: "hidden",
    shadowColor: colors.shadow,
    shadowOpacity: 1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  status: { flexDirection: "row", alignItems: "center", gap: space.sm, padding: space.lg },
  header: { ...type.caption, paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xs },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: 9 },
  copy: { flex: 1, minWidth: 0, gap: 1 },
  name: { color: colors.text, fontSize: 15, fontWeight: "600" },
  handle: { color: colors.muted, fontWeight: "400" },
  category: { color: colors.faint, fontSize: 12, fontWeight: "500" },
  badge: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: colors.raised },
  skillBadge: { backgroundColor: `${colors.accent}22` },
}));
