import React, { useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import type { CapabilityEntry } from "@/lib/gateway/types";
import { haptic, Icon } from "@/ui/primitives";
import { makeStyles, radius, space, useTheme } from "@/ui/theme";
import { EditorCard, ToggleRow } from "./EditorBits";

type SetToggle = (item: string, on: boolean) => void;

export function ToolsetsCard({
  toolsets,
  enabled,
  pinned,
  dirty,
  onToggle,
}: {
  toolsets: CapabilityEntry[];
  enabled: Set<string>;
  pinned: boolean;
  dirty: boolean;
  onToggle: SetToggle;
}) {
  const { type } = useTheme();
  let hint = `${enabled.size} of ${toolsets.length} enabled.`;
  if (!pinned && !dirty) hint += " Following Hermes defaults. Changing any switch gives this bot its own set.";
  if (dirty && enabled.size === 0) hint = "With everything off, this bot goes back to following Hermes defaults.";
  return (
    <EditorCard icon="construct-outline" title="Toolsets" hint={hint} dirty={dirty}>
      {toolsets.length === 0 ? <Text style={type.small}>No configurable toolsets.</Text> : null}
      <View>
        {toolsets.map((ts, index) => (
          <ToggleRow
            key={ts.name}
            label={ts.label || ts.name}
            description={ts.description}
            meta={typeof ts.tool_count === "number" ? `${ts.tool_count} ${ts.tool_count === 1 ? "tool" : "tools"}` : undefined}
            value={enabled.has(ts.name)}
            onChange={(on) => onToggle(ts.name, on)}
            last={index === toolsets.length - 1}
          />
        ))}
      </View>
    </EditorCard>
  );
}

const PREVIEW = 8;
type Filter = "all" | "on" | "off";

export function SkillsCard({
  skills,
  disabled,
  dirty,
  onToggle,
  onSetAll,
}: {
  skills: CapabilityEntry[];
  disabled: Set<string>;
  dirty: boolean;
  /** `on` = skill enabled. */
  onToggle: SetToggle;
  onSetAll: (disabledNames: Set<string>) => void;
}) {
  const { colors, type, scheme } = useTheme();
  const styles = useStyles();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState(false);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return skills.filter((s) => {
      if (q && !s.name.toLowerCase().includes(q)) return false;
      if (filter === "on") return !disabled.has(s.name);
      if (filter === "off") return disabled.has(s.name);
      return true;
    });
  }, [skills, query, filter, disabled]);

  const searching = query.trim().length > 0 || filter !== "all";
  const shown = expanded || searching ? visible : visible.slice(0, PREVIEW);
  const enabledCount = skills.length - skills.filter((s) => disabled.has(s.name)).length;

  const bulk = (enable: boolean) => {
    haptic.tap();
    const next = new Set(disabled);
    for (const s of visible) {
      if (enable) next.delete(s.name);
      else next.add(s.name);
    }
    onSetAll(next);
  };

  return (
    <EditorCard
      icon="sparkles-outline"
      title="Skills"
      hint={`${enabledCount} of ${skills.length} enabled. Disabled skills stay installed but are hidden from this bot.`}
      dirty={dirty}
    >
      <View style={styles.search}>
        <Icon name="search" size={16} color={colors.muted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={`Search ${skills.length} skills`}
          placeholderTextColor={colors.faint}
          keyboardAppearance={scheme}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          style={styles.searchInput}
          accessibilityLabel="Search skills"
        />
      </View>
      <View style={styles.filters}>
        {(["all", "on", "off"] as Filter[]).map((f) => (
          <Segment key={f} label={{ all: "All", on: "Enabled", off: "Disabled" }[f]} active={filter === f} onPress={() => setFilter(f)} />
        ))}
        <View style={{ flex: 1 }} />
        {visible.length > 0 ? (
          <>
            <TextAction label="All on" onPress={() => bulk(true)} />
            <TextAction label="All off" onPress={() => bulk(false)} />
          </>
        ) : null}
      </View>

      <View>
        {shown.map((skill, index) => (
          <ToggleRow
            key={skill.name}
            label={skill.name}
            value={!disabled.has(skill.name)}
            onChange={(on) => onToggle(skill.name, on)}
            last={index === shown.length - 1}
          />
        ))}
        {shown.length === 0 ? <Text style={[type.small, styles.none]}>No skills match.</Text> : null}
      </View>

      {!searching && visible.length > PREVIEW ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            haptic.tap();
            setExpanded((v) => !v);
          }}
          style={({ pressed }) => [styles.more, pressed && { opacity: 0.6 }]}
        >
          <Text style={styles.moreText}>{expanded ? "Show fewer" : `Show all ${visible.length}`}</Text>
          <Icon name={expanded ? "chevron-up" : "chevron-down"} size={16} color={colors.accentText} />
        </Pressable>
      ) : null}
    </EditorCard>
  );
}

export function McpCard({
  servers,
  enabled,
  dirty,
  onToggle,
}: {
  servers: CapabilityEntry[];
  enabled: Set<string>;
  dirty: boolean;
  onToggle: SetToggle;
}) {
  if (servers.length === 0) return null;
  return (
    <EditorCard icon="git-network-outline" title="MCP servers" hint="External tool servers this bot can call." dirty={dirty}>
      <View>
        {servers.map((srv, index) => (
          <ToggleRow
            key={srv.name}
            label={srv.name}
            meta={srv.transport}
            value={enabled.has(srv.name)}
            onChange={(on) => onToggle(srv.name, on)}
            last={index === servers.length - 1}
          />
        ))}
      </View>
    </EditorCard>
  );
}

function Segment({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      style={[styles.segment, active && styles.segmentActive]}
    >
      <Text style={[styles.segmentText, active && { color: colors.text }]}>{label}</Text>
    </Pressable>
  );
}

function TextAction({ label, onPress }: { label: string; onPress: () => void }) {
  const styles = useStyles();
  return (
    <Pressable accessibilityRole="button" hitSlop={6} onPress={onPress} style={({ pressed }) => pressed && { opacity: 0.6 }}>
      <Text style={styles.textAction}>{label}</Text>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingHorizontal: space.md,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.raised,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: 0 },
  filters: { flexDirection: "row", alignItems: "center", gap: space.xs },
  segment: { paddingHorizontal: space.md, height: 30, borderRadius: radius.pill, justifyContent: "center" },
  segmentActive: { backgroundColor: colors.overlay },
  segmentText: { fontSize: 13, fontWeight: "600", color: colors.muted },
  textAction: { fontSize: 13, fontWeight: "600", color: colors.accentText, paddingHorizontal: space.xs },
  none: { textAlign: "center", paddingVertical: space.lg },
  more: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.xs, paddingVertical: space.sm },
  moreText: { fontSize: 14, fontWeight: "600", color: colors.accentText },
}));
