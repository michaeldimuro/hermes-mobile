import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button, Icon } from "@/ui/primitives";
import { makeStyles, radius, space, useTheme } from "@/ui/theme";
import type { DriverStatus } from "./types";

type Props = {
  driver: DriverStatus | null;
  onRetry: (taskId: string) => void;
  onApprove: (action: Record<string, unknown>, choice: "once" | "deny") => void;
};

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** Surfaces the room driver's pending actions: a stalled turn to retry, or a tool approval to answer. */
export function DriverBanner({ driver, onRetry, onApprove }: Props) {
  const styles = useStyles();
  const { colors, type } = useTheme();
  const actions = driver?.pending_actions ?? [];
  const approval = actions.find((a) => a.kind === "approval");
  const retry = actions.find((a) => a.kind === "retry" && text(a.task_id));

  if (approval) {
    const details = (approval.approval ?? {}) as Record<string, unknown>;
    const summary = text(details.description) || text(details.command) || "A bot wants to run a tool.";
    const command = text(details.command);
    return (
      <View style={styles.banner} accessibilityLiveRegion="polite">
        <View style={styles.head}>
          <Icon name="shield-checkmark-outline" size={18} color={colors.warn} />
          <Text style={styles.title}>Approval needed</Text>
        </View>
        <Text style={type.small} numberOfLines={3}>
          {summary}
        </Text>
        {command && command !== summary ? (
          <Text style={styles.command} numberOfLines={3}>
            {command}
          </Text>
        ) : null}
        <View style={styles.row}>
          <Button title="Deny" variant="ghost" onPress={() => onApprove(approval, "deny")} style={styles.btn} />
          <Button title="Allow once" variant="accent" onPress={() => onApprove(approval, "once")} style={styles.btn} />
        </View>
      </View>
    );
  }
  if (retry) {
    return (
      <View style={styles.banner}>
        <View style={styles.head}>
          <Icon name="alert-circle-outline" size={18} color={colors.warn} />
          <Text style={[styles.title, { flex: 1 }]}>{"A bot's turn stalled"}</Text>
          <Button title="Retry" variant="secondary" onPress={() => onRetry(text(retry.task_id))} style={styles.small} />
        </View>
      </View>
    );
  }
  return null;
}

const useStyles = makeStyles((colors, type) => ({
  banner: {
    marginHorizontal: space.md,
    marginBottom: space.sm,
    padding: space.md,
    gap: space.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
  },
  head: { flexDirection: "row", alignItems: "center", gap: space.sm },
  title: { ...type.heading, fontSize: 15 },
  command: {
    ...type.mono,
    color: colors.textSoft,
    backgroundColor: colors.bg,
    borderRadius: radius.sm,
    padding: space.sm,
  },
  row: { flexDirection: "row", gap: space.sm },
  btn: { flex: 1, minHeight: 42 },
  small: { minHeight: 34, paddingHorizontal: space.lg },
}));
