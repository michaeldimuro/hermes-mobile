import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text } from "react-native";
import { useGateway } from "@/lib/store/GatewayProvider";
import { haptic, Icon } from "@/ui/primitives";
import { makeStyles, radius, space, useTheme } from "@/ui/theme";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { EASE_OUT } from "@/ui/motion";

const BANNER_IN = FadeIn.duration(200).easing(EASE_OUT);
const BANNER_OUT = FadeOut.duration(160).easing(EASE_OUT);

const SLOW_MS = 2_000;

/**
 * Connection status, shown only when it matters: a diagnosed problem (unreachable host, blocked
 * WebSocket) immediately, and a plain "Connecting…" only if connecting takes longer than 2s.
 */
export function ConnectionBanner() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { connection, connectionIssue, retry } = useGateway();
  const down = connection !== "open";
  const [slow, setSlow] = useState(false);
  const [wasDown, setWasDown] = useState(down);
  if (down !== wasDown) {
    setWasDown(down);
    setSlow(false);
  }
  useEffect(() => {
    if (!down) return;
    const timer = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(timer);
  }, [down]);

  if (!down || (!connectionIssue && !slow)) return null;
  const problem = Boolean(connectionIssue);
  return (
    <Animated.View entering={BANNER_IN} exiting={BANNER_OUT}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${connectionIssue?.message ?? "Connecting to Hermes"}. Retry now`}
        onPress={() => {
          haptic.tap();
          retry();
        }}
        style={({ pressed }) => [
          styles.banner,
          problem && styles.problem,
          pressed && { opacity: 0.7 },
        ]}
      >
        {problem ? (
          <Icon name="cloud-offline-outline" size={15} color={colors.danger} />
        ) : (
          <ActivityIndicator
            size="small"
            color={colors.muted}
            style={{ transform: [{ scale: 0.7 }] }}
          />
        )}
        <Text
          style={[styles.text, problem && { color: colors.danger }]}
          numberOfLines={3}
        >
          {connectionIssue?.message ?? "Connecting to Hermes…"}
        </Text>
        {problem ? <Text style={styles.retry}>Retry</Text> : null}
      </Pressable>
    </Animated.View>
  );
}

const useStyles = makeStyles((colors) => ({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    gap: space.sm,
    maxWidth: 520,
    marginHorizontal: space.md,
    marginBottom: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: 7,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  problem: { backgroundColor: colors.dangerBg },
  text: { color: colors.muted, fontSize: 12, lineHeight: 16, flexShrink: 1 },
  retry: { color: colors.danger, fontSize: 12, fontWeight: "700" },
}));
