import React from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { Button, Icon } from "@/ui/primitives";
import { makeStyles, radius, space, useTheme } from "@/ui/theme";
import { formatBytes, type MediaKind } from "../kinds";
import { kindIcon, kindLabel } from "../kindIcon";

/** Fallback body: file facts + "Open in…" (OS share sheet), also used for loading and error states. */
export function FileInfo({
  name,
  kind,
  size,
  note,
  error,
  loading,
  onOpen,
  onRetry,
}: {
  name: string;
  kind: MediaKind;
  size?: number | null;
  note?: string;
  error?: string | null;
  loading?: boolean;
  onOpen?: () => void;
  onRetry?: () => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const meta = [kindLabel(kind, name), formatBytes(size)].filter(Boolean).join(" · ");
  return (
    <View style={styles.wrap}>
      <View style={styles.tile}>
        <Icon name={kindIcon(kind)} size={44} color={error ? colors.danger : colors.accentText} />
      </View>
      <Text style={styles.name} numberOfLines={3}>
        {name}
      </Text>
      {meta ? <Text style={styles.meta}>{meta}</Text> : null}
      {loading ? <ActivityIndicator color={colors.muted} style={{ marginTop: space.md }} /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {note ? <Text style={styles.meta}>{note}</Text> : null}
      <View style={styles.actions}>
        {error && onRetry ? <Button title="Try again" icon="refresh" variant="secondary" onPress={onRetry} /> : null}
        {!error && !loading && onOpen ? <Button title="Open in…" icon="open-outline" variant="primary" onPress={onOpen} /> : null}
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors, type) => ({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl, gap: space.sm },
  tile: {
    width: 96,
    height: 96,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: space.md,
  },
  name: { ...type.heading, textAlign: "center" },
  meta: { ...type.small, textAlign: "center" },
  error: { color: colors.danger, fontSize: 14, textAlign: "center", marginTop: space.sm },
  actions: { marginTop: space.lg, gap: space.sm, alignSelf: "stretch", paddingHorizontal: space.xl },
}));
