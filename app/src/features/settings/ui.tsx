import React, { ReactNode, useEffect, useState } from "react";
import { Keyboard, Platform, StyleSheet, Text, View } from "react-native";
import { Icon, IconName, PressableRow } from "@/ui/primitives";
import { makeStyles, type Palette, radius, space, useTheme } from "@/ui/theme";
import type { Tone } from "./format";

export function toneColor(tone: Tone, colors: Palette): string {
  return { success: colors.success, warn: colors.warn, danger: colors.danger, muted: colors.faint }[tone];
}

export function StatusDot({ tone, size = 8 }: { tone: Tone; size?: number }) {
  const { colors } = useTheme();
  const color = toneColor(tone, colors);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        shadowColor: color,
        shadowOpacity: tone === "muted" ? 0 : 0.8,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 0 },
      }}
    />
  );
}

/** Small rounded status pill ("Paused", "Succeeded"). */
export function Pill({ label, tone, icon }: { label: string; tone: Tone; icon?: IconName }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const color = toneColor(tone, colors);
  return (
    <View style={[styles.pill, { borderColor: `${color}55`, backgroundColor: `${color}14` }]}>
      {icon ? <Icon name={icon} size={11} color={color} /> : null}
      <Text style={[styles.pillText, { color }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** Rounded grouped card; children are separated with inset hairlines. */
export function GroupCard({ children, inset = 60 }: { children: ReactNode; inset?: number }) {
  const styles = useStyles();
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={styles.card}>
      {items.map((child, index) => (
        <React.Fragment key={index}>
          {index > 0 ? <View style={[styles.separator, { marginLeft: inset }]} /> : null}
          {child}
        </React.Fragment>
      ))}
    </View>
  );
}

export function IconTile({ icon, tint }: { icon: IconName; tint?: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const color = tint ?? colors.accentText;
  return (
    <View style={[styles.tile, { backgroundColor: `${color}1F` }]}>
      <Icon name={icon} size={18} color={color} />
    </View>
  );
}

/** iOS-style navigation row: icon tile, title + description, trailing content or chevron. */
export function SettingsRow({
  icon,
  tint,
  title,
  subtitle,
  onPress,
  right,
  destructive,
  accessibilityHint,
}: {
  icon: IconName;
  tint?: string;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  right?: ReactNode;
  destructive?: boolean;
  accessibilityHint?: string;
}) {
  const styles = useStyles();
  const { colors, type } = useTheme();
  return (
    <PressableRow
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      disabled={!onPress}
      style={styles.row}
    >
      <IconTile icon={icon} tint={destructive ? colors.danger : tint} />
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, destructive && { color: colors.danger }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={type.small} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ?? (onPress && !destructive ? <Icon name="chevron-forward" size={18} color={colors.faint} /> : null)}
    </PressableRow>
  );
}

/** iOS modals don't resize for the keyboard; returns the height to pad sheet content by. */
export function useKeyboardInset(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    const show = Keyboard.addListener("keyboardWillShow", (e) => setHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener("keyboardWillHide", () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}

const useStyles = makeStyles((colors, type) => ({
  card: {
    marginHorizontal: space.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: "hidden",
  },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  row: { borderRadius: 0, paddingVertical: space.md, minHeight: 60 },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { ...type.heading, fontSize: 15 },
  tile: { width: 32, height: 32, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    height: 22,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pillText: { fontSize: 11, fontWeight: "600" },
}));
