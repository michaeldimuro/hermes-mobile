import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import Animated, { FadeInDown, FadeOutUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useGateway } from "@/lib/store/GatewayProvider";
import { Icon, IconName } from "@/ui/primitives";
import { EASE_OUT } from "@/ui/motion";
import { makeStyles, radius, space, useTheme } from "@/ui/theme";

// Enters from the top edge and leaves the same way, ~20% faster than it arrived.
const TOAST_IN = FadeInDown.duration(240).easing(EASE_OUT);
const TOAST_OUT = FadeOutUp.duration(190).easing(EASE_OUT);

const LEVEL_ICONS: Record<string, IconName> = {
  info: "information-circle",
  success: "checkmark-circle",
  warn: "warning",
  error: "alert-circle",
};

/** Transient notices (gateway notifications, errors, confirmations) floating above everything. */
export function ToastHost() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { toast, dismissToast } = useGateway();
  const insets = useSafeAreaInsets();
  if (!toast) return null;
  const tone = { info: colors.textSoft, success: colors.success, warn: colors.warn, error: colors.danger }[toast.level];
  return (
    <Animated.View
      key={toast.id}
      entering={TOAST_IN}
      exiting={TOAST_OUT}
      pointerEvents="box-none"
      style={[styles.wrap, { top: insets.top + space.sm }]}
    >
      <Pressable accessibilityRole="alert" onPress={dismissToast} style={styles.toast}>
        <Icon name={LEVEL_ICONS[toast.level] ?? LEVEL_ICONS.info} size={18} color={tone} />
        <Text style={styles.text} numberOfLines={3}>
          {toast.text}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const useStyles = makeStyles((colors, type) => ({
  wrap: { position: "absolute", left: space.lg, right: space.lg, alignItems: "center" },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    maxWidth: 520,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.overlay,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    shadowColor: colors.shadow,
    shadowOpacity: 0.5,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  text: { color: colors.text, fontSize: 14, flexShrink: 1 },
}));
