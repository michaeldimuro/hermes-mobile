import React, { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { BotAvatar, Button, Icon, PressableRow, SectionLabel, Sheet, type IconName } from "@/ui/primitives";
import { botColor, makeStyles, radius, space, useTheme } from "@/ui/theme";
import type { MemberView } from "./groupEvents";

type Props = {
  visible: boolean;
  onClose: () => void;
  name: string;
  members: MemberView[];
  busy: boolean;
  onRename: (name: string) => Promise<boolean>;
  onStop: () => void;
  onDisband: () => void;
};

/** Room "⋯" sheet: roster, rename, stop current work, disband. */
export function RoomSheet({ visible, onClose, name, members, busy, onRename, onStop, onDisband }: Props) {
  const styles = useStyles();
  const { colors, type, scheme } = useTheme();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(name);
  const [saving, setSaving] = useState(false);

  // Leave rename mode when the sheet closes and resync the draft when it opens or the name changes.
  const [prev, setPrev] = useState({ visible, name });
  if (prev.visible !== visible || prev.name !== name) {
    setPrev({ visible, name });
    if (!visible) setRenaming(false);
    setDraft(name);
  }

  const save = async () => {
    setSaving(true);
    const ok = await onRename(draft);
    setSaving(false);
    if (ok) {
      setRenaming(false);
      onClose();
    }
  };

  const confirmDisband = () =>
    Alert.alert(
      `Disband “${name}”?`,
      "The room and its history are closed for everyone. Running bot work is stopped first. This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Disband", style: "destructive", onPress: onDisband },
      ],
    );

  return (
    <Sheet visible={visible} onClose={onClose} title={name}>
      {/* Bottom-anchored sheet: padding grows it above the keyboard while renaming. */}
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: space.sm }}>
        {renaming ? (
          <View style={styles.renameBox}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              autoFocus
              maxLength={80}
              placeholder="Room name"
              placeholderTextColor={colors.faint}
              keyboardAppearance={scheme}
              style={styles.input}
              returnKeyType="done"
              onSubmitEditing={save}
              accessibilityLabel="Room name"
            />
            <View style={styles.renameActions}>
              <Button title="Cancel" variant="ghost" onPress={() => setRenaming(false)} style={{ flex: 1 }} />
              <Button
                title="Save"
                loading={saving}
                disabled={!draft.trim() || draft.trim() === name}
                onPress={save}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        ) : (
          <>
            <SectionLabel>{`MEMBERS · ${members.length}`}</SectionLabel>
            {members.map((member) => (
              <View key={member.id} style={styles.member}>
                <BotAvatar name={member.profile} size={34} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[type.heading, { color: botColor(member.profile, colors) }]} numberOfLines={1}>
                    {member.name}
                  </Text>
                  <Text style={type.small} numberOfLines={1}>
                    @{member.handle}
                  </Text>
                </View>
              </View>
            ))}
            <SectionLabel>ROOM</SectionLabel>
            <Action icon="create-outline" label="Rename" onPress={() => setRenaming(true)} />
            <Action
              icon="stop-circle-outline"
              label={busy ? "Stop current work" : "Stop current work (idle)"}
              onPress={() => {
                onClose();
                onStop();
              }}
            />
            <Action icon="trash-outline" label="Disband room" danger onPress={confirmDisband} />
          </>
        )}
      </ScrollView>
      </KeyboardAvoidingView>
    </Sheet>
  );
}

function Action({ icon, label, danger, onPress }: { icon: IconName; label: string; danger?: boolean; onPress: () => void }) {
  const styles = useStyles();
  const { colors, type } = useTheme();
  const tint = danger ? colors.danger : colors.text;
  return (
    <PressableRow accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.action}>
      <Icon name={icon} size={20} color={tint} />
      <Text style={[type.body, { color: tint, flex: 1 }]}>{label}</Text>
    </PressableRow>
  );
}

const useStyles = makeStyles((colors, type) => ({
  member: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.xl, paddingVertical: space.sm },
  action: { marginHorizontal: space.sm, paddingHorizontal: space.md },
  renameBox: { paddingHorizontal: space.xl, gap: space.md, paddingTop: space.sm },
  input: {
    ...type.body,
    backgroundColor: colors.raised,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  renameActions: { flexDirection: "row", gap: space.md },
}));
