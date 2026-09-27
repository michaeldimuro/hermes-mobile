import React, { memo } from "react";
import { Switch, Text, View } from "react-native";
import { makeStyles, space, useTheme } from "@/ui/theme";
import { titleCase } from "./format";
import type { Skill } from "./types";

const PROVENANCE: Record<string, string> = { hub: "Hub", bundled: "Built-in", agent: "Custom" };

export const SkillRow = memo(function SkillRow({
  skill,
  onToggle,
}: {
  skill: Skill;
  onToggle: (name: string, enabled: boolean) => void;
}) {
  const meta = [skill.category ? titleCase(skill.category) : null, skill.provenance ? PROVENANCE[skill.provenance] : null]
    .filter(Boolean)
    .join(" · ");
  const styles = useStyles();
  const { colors, type } = useTheme();
  const dark = colors.scheme === "dark";
  return (
    <View style={styles.row}>
      <View style={styles.text}>
        <Text style={[styles.name, !skill.enabled && { color: colors.muted }]} numberOfLines={1}>
          {skill.name}
        </Text>
        {skill.description ? (
          <Text style={type.small} numberOfLines={2}>
            {skill.description}
          </Text>
        ) : null}
        {meta ? <Text style={styles.meta}>{meta}</Text> : null}
      </View>
      <Switch
        accessibilityLabel={`${skill.name} skill`}
        accessibilityHint={skill.enabled ? "Disables this skill" : "Enables this skill"}
        value={skill.enabled}
        onValueChange={(value) => onToggle(skill.name, value)}
        trackColor={{ false: dark ? colors.overlay : colors.borderStrong, true: colors.accent }}
        thumbColor={dark ? colors.text : colors.bg}
        ios_backgroundColor={dark ? colors.overlay : colors.borderStrong}
      />
    </View>
  );
});

const useStyles = makeStyles((colors, type) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    backgroundColor: colors.surface,
  },
  text: { flex: 1, minWidth: 0, gap: 2 },
  name: { ...type.heading, fontSize: 15 },
  meta: { ...type.caption, letterSpacing: 0.3, fontWeight: "500", marginTop: 2 },
}));
