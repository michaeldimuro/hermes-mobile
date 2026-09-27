import React, { ComponentProps, ReactNode, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  PressableProps,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { EASE_OUT_CSS } from "./motion";
import { botColor, makeStyles, radius, space, useTheme } from "./theme";

export type IconName = ComponentProps<typeof Ionicons>["name"];

export const haptic = {
  tap: () => void Haptics.selectionAsync().catch(() => undefined),
  press: () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined),
  success: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined),
  warn: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined),
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * Pressable that dips to 97% on press-in (feedback before the tap completes) and eases back —
 * 120ms, near-imperceptible, because it's touched dozens of times a day. Transform only.
 */
export function PressScale({
  style,
  onPressIn,
  onPressOut,
  children,
  scaleTo = 0.97,
  ...props
}: Omit<PressableProps, "style" | "children"> & { style?: StyleProp<ViewStyle>; children: ReactNode; scaleTo?: number }) {
  const [pressed, setPressed] = useState(false);
  return (
    <AnimatedPressable
      {...props}
      pressRetentionOffset={16}
      onPressIn={(event) => {
        setPressed(true);
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        setPressed(false);
        onPressOut?.(event);
      }}
      style={[style, PRESS_TRANSITION, { transform: [{ scale: pressed && !props.disabled ? scaleTo : 1 }] }]}
    >
      {children}
    </AnimatedPressable>
  );
}

const PRESS_TRANSITION = {
  transitionProperty: "transform",
  transitionDuration: 120,
  transitionTimingFunction: EASE_OUT_CSS,
} as const;

export function Icon({ name, size = 20, color }: { name: IconName; size?: number; color?: string }) {
  const { colors } = useTheme();
  return <Ionicons name={name} size={size} color={color ?? colors.text} />;
}

export function IconButton({
  icon,
  label,
  onPress,
  size = 20,
  color,
  filled,
  disabled,
  style,
}: {
  icon: IconName;
  label: string;
  onPress?: () => void;
  size?: number;
  color?: string;
  filled?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      disabled={disabled}
      onPress={() => {
        haptic.tap();
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.iconButton,
        filled && styles.iconButtonFilled,
        pressed && { opacity: 0.6 },
        disabled && { opacity: 0.35 },
        style,
      ]}
    >
      <Icon name={icon} size={size} color={color} />
    </Pressable>
  );
}

export function Button({
  title,
  onPress,
  variant = "primary",
  icon,
  loading,
  disabled,
  style,
}: {
  title: string;
  onPress?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "accent";
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const palette = {
    primary: { bg: colors.primary, fg: colors.primaryInk, border: colors.primary },
    accent: { bg: colors.accent, fg: colors.accentInk, border: colors.accent },
    secondary: { bg: colors.raised, fg: colors.text, border: colors.border },
    ghost: { bg: "transparent", fg: colors.text, border: colors.border },
    danger: { bg: colors.dangerBg, fg: colors.danger, border: `${colors.danger}44` },
  }[variant];
  return (
    <PressScale
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={() => {
        haptic.press();
        onPress?.();
      }}
      style={[
        styles.button,
        { backgroundColor: palette.bg, borderColor: palette.border },
        (disabled || loading) && { opacity: 0.45 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={18} color={palette.fg} /> : null}
          <Text style={[styles.buttonText, { color: palette.fg }]}>{title}</Text>
        </>
      )}
    </PressScale>
  );
}

export function Chip({
  label,
  icon,
  active,
  onPress,
  tint,
}: {
  label: string;
  icon?: IconName;
  active?: boolean;
  onPress?: () => void;
  tint?: string;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <PressScale
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={() => {
        haptic.tap();
        onPress?.();
      }}
      style={[styles.chip, active && { backgroundColor: colors.overlay, borderColor: tint ?? colors.borderStrong }]}
    >
      {icon ? <Icon name={icon} size={15} color={active ? (tint ?? colors.text) : colors.muted} /> : null}
      <Text style={[styles.chipText, active && { color: tint ?? colors.text }]}>{label}</Text>
    </PressScale>
  );
}

export function BotAvatar({ name, size = 36, ring }: { name: string; size?: number; ring?: boolean }) {
  const { colors } = useTheme();
  const tint = botColor(name, colors);
  const initial = name === "default" ? "H" : name.trim().slice(0, 1).toUpperCase() || "H";
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: `${tint}22`,
        borderWidth: ring ? 2 : 1,
        borderColor: ring ? tint : `${tint}55`,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: tint, fontWeight: "700", fontSize: size * 0.42 }}>{initial}</Text>
    </View>
  );
}

export function PressableRow({ children, style, ...props }: PressableProps & { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <Pressable {...props} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.raised }, style]}>
      {children}
    </Pressable>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  const styles = useStyles();
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

export { Sheet } from "./Sheet";

/** Standard screen top bar: back button, title/subtitle, optional trailing actions. */
export function ScreenHeader({
  title,
  subtitle,
  onBack,
  right,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: ReactNode;
}) {
  const styles = useStyles();
  const { type } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top + space.xs }]}>
      {onBack ? <IconButton icon="chevron-back" label="Back" onPress={onBack} size={24} /> : <View style={{ width: 8 }} />}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={type.title}>
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} style={type.small}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: IconName; title: string; body?: string; action?: ReactNode }) {
  const styles = useStyles();
  const { colors, type } = useTheme();
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Icon name={icon} size={26} color={colors.muted} />
      </View>
      <Text style={type.heading}>{title}</Text>
      {body ? <Text style={[type.small, { textAlign: "center" }]}>{body}</Text> : null}
      {action}
    </View>
  );
}

const useStyles = makeStyles((colors, type) => ({
  iconButton: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  iconButtonFilled: { backgroundColor: colors.raised, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  button: {
    minHeight: 50,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: space.xl,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
  },
  buttonText: { fontSize: 16, fontWeight: "600" },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    height: 36,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipText: { color: colors.muted, fontSize: 14, fontWeight: "500" },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, borderRadius: radius.md },
  sectionLabel: { ...type.caption, paddingHorizontal: space.lg, marginTop: space.xl, marginBottom: space.sm },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingHorizontal: space.sm,
    paddingBottom: space.sm,
    backgroundColor: colors.bg,
  },
  empty: { alignItems: "center", gap: space.sm, padding: space.xxl },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.raised,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: space.sm,
  },
}));
