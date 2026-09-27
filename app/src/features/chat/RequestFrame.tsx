import React from "react";
import { Text, View } from "react-native";
import { Icon, IconName } from "@/ui/primitives";
import { makeStyles, radius, space, useTheme } from "@/ui/theme";

/** The card every agent question sits in (approvals, clarify, secrets, logins). */
export function RequestFrame({ icon, title, children }: { icon: IconName; title: string; children: React.ReactNode }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.card} accessibilityRole="alert">
      <View style={styles.cardHeader}>
        <View style={styles.badge}>
          <Icon name={icon} size={15} color={colors.accentInk} />
        </View>
        <Text style={styles.title}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

const useStyles = makeStyles((colors, type) => ({
  card: {
    marginHorizontal: space.md,
    marginBottom: space.sm,
    padding: space.lg,
    gap: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: `${colors.accent}55`,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: space.sm },
  badge: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  title: { ...type.heading, flex: 1 },
}));
