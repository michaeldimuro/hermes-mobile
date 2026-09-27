import React, { useEffect, useMemo, useState } from "react";
import { Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { haptic, Icon } from "@/ui/primitives";
import { botColor, makeStyles, radius, space, useTheme } from "@/ui/theme";
import { mentionedHandles, toggleMention, type MemberView } from "./groupEvents";

type Props = {
  members: MemberView[];
  /** Bots are mid-discussion: an empty composer offers Stop instead of Send. */
  busy: boolean;
  disabled?: boolean;
  onSend: (text: string) => Promise<boolean>;
  onStop: () => void;
};

/** Multiline composer with @mention quick-chips (the server routes by inline `@handle`). */
export function GroupComposer({ members, busy, disabled, onSend, onStop }: Props) {
  const styles = useStyles();
  const { colors, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState("");
  const keyboardOpen = useKeyboardOpen();
  const mentioned = useMemo(() => mentionedHandles(draft, members).handles, [draft, members]);
  const canSend = draft.trim().length > 0 && !disabled;
  const showStop = busy && !canSend;

  const submit = async () => {
    if (!canSend) return;
    const text = draft;
    haptic.press();
    setDraft("");
    const ok = await onSend(text);
    if (!ok) setDraft((current) => current || text);
  };

  const hint = mentioned.size
    ? `Only ${members.filter((m) => mentioned.has(m.handle.toLowerCase())).map((m) => m.name).join(", ")} will reply`
    : "Everyone in the room will reply";

  return (
    <View style={[styles.wrap, { paddingBottom: keyboardOpen ? space.sm : Math.max(insets.bottom, space.sm) }]}>
      {members.length ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="always"
          contentContainerStyle={styles.chips}
        >
          {members.map((member) => {
            const active = mentioned.has(member.handle.toLowerCase());
            const tint = botColor(member.profile, colors);
            return (
              <Pressable
                key={member.id}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${active ? "Remove mention of" : "Mention"} ${member.name}`}
                onPress={() => {
                  haptic.tap();
                  setDraft((current) => toggleMention(current, member.handle));
                }}
                style={({ pressed }) => [
                  styles.chip,
                  active && { borderColor: tint, backgroundColor: `${tint}1F` },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Text style={[styles.chipText, { color: active ? tint : colors.muted }]}>@{member.handle}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
      <View style={styles.inputRow}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Message the room"
          placeholderTextColor={colors.faint}
          keyboardAppearance={scheme}
          multiline
          editable={!disabled}
          style={styles.input}
          accessibilityLabel="Message the room"
          accessibilityHint={hint}
          maxLength={60_000}
        />
        {showStop ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Stop the bots"
            hitSlop={6}
            onPress={() => {
              haptic.warn();
              onStop();
            }}
            style={({ pressed }) => [styles.action, styles.stop, pressed && { opacity: 0.7 }]}
          >
            <View style={styles.stopGlyph} />
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send message"
            accessibilityState={{ disabled: !canSend }}
            hitSlop={6}
            disabled={!canSend}
            onPress={submit}
            style={({ pressed }) => [styles.action, !canSend && styles.actionOff, pressed && { opacity: 0.75 }]}
          >
            <Icon name="arrow-up" size={20} color={canSend ? colors.primaryInk : colors.faint} />
          </Pressable>
        )}
      </View>
      {draft.length > 0 ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

/** While the keyboard is up the home-indicator inset is covered, so the composer drops it. */
function useKeyboardOpen() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", () => setOpen(true));
    const hide = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => setOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return open;
}

const useStyles = makeStyles((colors, type) => ({
  wrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
    paddingTop: space.sm,
  },
  chips: { gap: space.sm, paddingHorizontal: space.md, paddingBottom: space.sm },
  chip: {
    height: 30,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    justifyContent: "center",
  },
  chipText: { fontSize: 13, fontWeight: "600" },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: space.sm,
    marginHorizontal: space.md,
    backgroundColor: colors.raised,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    paddingLeft: space.lg,
    paddingRight: 6,
    paddingVertical: 6,
  },
  input: { ...type.body, flex: 1, maxHeight: 140, paddingTop: 8, paddingBottom: 8 },
  action: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  actionOff: { backgroundColor: colors.overlay },
  stop: { backgroundColor: colors.primary },
  stopGlyph: { width: 12, height: 12, borderRadius: 3, backgroundColor: colors.primaryInk },
  hint: { ...type.small, fontSize: 11, marginTop: 6, marginHorizontal: space.xl },
}));
