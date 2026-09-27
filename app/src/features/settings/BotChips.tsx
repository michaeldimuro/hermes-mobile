import React from "react";
import { ScrollView } from "react-native";
import type { ProfileRow } from "@/lib/gateway/types";
import { Chip } from "@/ui/primitives";
import { botColor, makeStyles, space, useTheme } from "@/ui/theme";

export function botLabel(profile: Pick<ProfileRow, "name" | "display_name">): string {
  return profile.display_name?.trim() || profile.name;
}

/** Horizontal, single-select bot picker. `leading` renders before the bot chips (e.g. an "All" chip). */
export function BotChips({
  profiles,
  value,
  onChange,
  leading,
  inset = space.lg,
}: {
  profiles: Pick<ProfileRow, "name" | "display_name">[];
  value: string | null;
  onChange: (name: string) => void;
  leading?: React.ReactNode;
  inset?: number;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[styles.row, { paddingHorizontal: inset }]}
      accessibilityRole="radiogroup"
    >
      {leading}
      {profiles.map((p) => (
        <Chip
          key={p.name}
          label={botLabel(p)}
          icon="ellipse"
          tint={botColor(p.name, colors)}
          active={value === p.name}
          onPress={() => onChange(p.name)}
        />
      ))}
    </ScrollView>
  );
}

const useStyles = makeStyles(() => ({
  row: { gap: space.sm, alignItems: "center" },
}));
