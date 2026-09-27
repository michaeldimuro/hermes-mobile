import React, { ReactNode, useEffect, useState } from "react";
import { Animated, Pressable, StyleSheet, Switch, Text, TextInput, TextInputProps, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, haptic, Icon, IconName } from "@/ui/primitives";
import { makeStyles, radius, space, useTheme } from "@/ui/theme";
import { splitLabel } from "./format";

/** A titled, rounded settings card. */
export function EditorCard({
  icon,
  title,
  hint,
  right,
  dirty,
  children,
}: {
  icon: IconName;
  title: string;
  hint?: string;
  right?: ReactNode;
  dirty?: boolean;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Icon name={icon} size={17} color={colors.muted} />
        <Text style={styles.cardTitle}>{title}</Text>
        {dirty ? <View style={styles.dirtyDot} accessibilityLabel="Edited" /> : null}
        <View style={{ flex: 1 }} />
        {right}
      </View>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {children}
    </View>
  );
}

export function EditorField({ minHeight = 48, style, ...props }: TextInputProps & { minHeight?: number }) {
  const { colors, scheme } = useTheme();
  const styles = useStyles();
  return (
    <TextInput
      placeholderTextColor={colors.faint}
      selectionColor={colors.accent}
      keyboardAppearance={scheme}
      textAlignVertical={props.multiline ? "top" : "center"}
      {...props}
      style={[styles.field, { minHeight }, props.multiline && styles.fieldMulti, style]}
    />
  );
}

/** Label + optional description + native Switch; the whole row toggles. */
export function ToggleRow({
  label,
  description,
  meta,
  value,
  onChange,
  last,
}: {
  label: string;
  description?: string;
  meta?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  last?: boolean;
}) {
  const { colors, scheme } = useTheme();
  const styles = useStyles();
  const { glyph, text } = splitLabel(label);
  const flip = (next: boolean) => {
    haptic.tap();
    onChange(next);
  };
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      aria-checked={value}
      accessibilityLabel={text}
      accessibilityHint={description}
      onPress={() => flip(!value)}
      style={({ pressed }) => [styles.toggle, !last && styles.toggleBorder, pressed && { opacity: 0.7 }]}
    >
      {glyph ? <Text style={styles.glyph}>{glyph}</Text> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={[styles.toggleLabel, !value && { color: colors.muted }]}>
          {text}
        </Text>
        {description || meta ? (
          <Text numberOfLines={2} style={styles.toggleDesc}>
            {[meta, description].filter(Boolean).join(" · ")}
          </Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={flip}
        trackColor={{ false: colors.borderStrong, true: colors.accent }}
        thumbColor={scheme === "dark" ? colors.text : colors.overlay}
        ios_backgroundColor={colors.borderStrong}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
    </Pressable>
  );
}

/** Tappable settings row with a trailing chevron (model picker, etc.). */
export function ValueRow({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      style={({ pressed }) => [styles.valueRow, pressed && { backgroundColor: colors.overlay }]}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.valueLabel}>{label}</Text>
        <Text numberOfLines={1} style={styles.valueText}>
          {value}
        </Text>
      </View>
      <Icon name="chevron-forward" size={18} color={colors.muted} />
    </Pressable>
  );
}

/** Pulsing placeholder blocks while `profiles.describe` loads. */
export function Skeleton({ lines = 3 }: { lines?: number }) {
  const styles = useStyles();
  const [pulse] = useState(() => new Animated.Value(0.4));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.9, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <View style={{ gap: space.md }} accessibilityLabel="Loading">
      {Array.from({ length: lines }, (_, i) => (
        <Animated.View key={i} style={[styles.skeleton, { opacity: pulse, width: i === lines - 1 ? "60%" : "100%" }]} />
      ))}
    </View>
  );
}

/** Sticky footer shown while the editor has unsaved changes. */
export function SaveBar({
  visible,
  count,
  saving,
  onSave,
  onDiscard,
}: {
  visible: boolean;
  count: number;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const [slide] = useState(() => new Animated.Value(visible ? 1 : 0));
  useEffect(() => {
    Animated.spring(slide, { toValue: visible ? 1 : 0, useNativeDriver: true, bounciness: 4, speed: 18 }).start();
  }, [visible, slide]);
  return (
    <Animated.View
      pointerEvents={visible ? "auto" : "none"}
      style={[
        styles.saveBar,
        { paddingBottom: Math.max(insets.bottom, space.md) },
        { opacity: slide, transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [120, 0] }) }] },
      ]}
    >
      <Text style={styles.saveText}>
        {count} unsaved {count === 1 ? "change" : "changes"}
      </Text>
      <Button title="Discard" variant="ghost" onPress={onDiscard} disabled={saving} style={styles.saveBtn} />
      <Button title="Save" variant="accent" onPress={onSave} loading={saving} style={styles.saveBtn} />
    </Animated.View>
  );
}

const useStyles = makeStyles((colors, type) => ({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: space.lg,
    gap: space.md,
  },
  cardHead: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 28 },
  cardTitle: { ...type.heading },
  dirtyDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.accent },
  hint: { ...type.small, marginTop: -space.xs },
  field: {
    backgroundColor: colors.raised,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: space.md,
  },
  fieldMulti: { paddingTop: space.md, paddingBottom: space.md, lineHeight: 21, maxHeight: 360 },
  toggle: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md },
  toggleBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  glyph: { fontSize: 18, width: 24, textAlign: "center" },
  toggleLabel: { fontSize: 15, fontWeight: "500", color: colors.text },
  toggleDesc: { ...type.small, marginTop: 2 },
  valueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    backgroundColor: colors.raised,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
  },
  valueLabel: { ...type.caption },
  valueText: { fontSize: 15, color: colors.text, fontWeight: "500", marginTop: 2 },
  skeleton: { height: 14, borderRadius: 7, backgroundColor: colors.raised },
  saveBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderStrong,
  },
  saveText: { flex: 1, fontSize: 14, fontWeight: "600", color: colors.textSoft },
  saveBtn: { minHeight: 42, paddingHorizontal: space.lg },
}));
