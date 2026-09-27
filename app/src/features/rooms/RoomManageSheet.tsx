import React, { useState } from "react";
import { Alert, ScrollView, Text, TextInput, View } from "react-native";
import { useGateway } from "@/lib/store/GatewayProvider";
import { BotAvatar, Button, Chip, IconButton, Sheet } from "@/ui/primitives";
import { botColor, makeStyles, radius, space, useTheme } from "@/ui/theme";
import { MAX_MEMBERS } from "./engine/mirrorCodec";
import type { DisplayName } from "./RoomBits";
import type { MirrorMember } from "./roomMirror";

type Props = {
  visible: boolean;
  onClose: () => void;
  name: string;
  members: MirrorMember[];
  /** Member profile names the user told to stop (desktop holds). */
  held: Set<string>;
  displayName: DisplayName;
  busy: boolean;
  onRename: (name: string) => Promise<void>;
  onSetMembers: (names: string[]) => Promise<void>;
  onHold: (member: MirrorMember, pause: boolean) => void;
  onDelete: () => Promise<void>;
};

/** Everything about a desktop group: its name, who's in it, who's paused, and deleting it. */
export function RoomManageSheet(props: Props) {
  const styles = useStyles();
  const { colors, type } = useTheme();
  const { profiles } = useGateway();
  const [name, setName] = useState(props.name);
  const [syncedName, setSyncedName] = useState(props.name);
  if (props.name !== syncedName) {
    setSyncedName(props.name);
    setName(props.name);
  }
  const [working, setWorking] = useState(false);
  const localNames = [...new Set(props.members.filter((m) => m.local).map((m) => m.name))];
  const addable = profiles.filter((p) => !props.members.some((m) => m.name === p.name));

  const run = async (task: () => Promise<void>) => {
    setWorking(true);
    try {
      await task();
    } catch (error) {
      Alert.alert("Couldn't update the group", error instanceof Error ? error.message : String(error));
    } finally {
      setWorking(false);
    }
  };

  const rename = () => {
    const next = name.trim();
    if (next && next !== props.name) void run(() => props.onRename(next));
  };

  const remove = (member: MirrorMember) =>
    Alert.alert(`Remove ${props.displayName(member.name)}?`, "It stops getting this group's messages. Its past replies stay.", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => void run(() => props.onSetMembers(localNames.filter((n) => n !== member.name))) },
    ]);

  const removeGroup = () =>
    Alert.alert("Delete this group?", "It's removed from Hermes desktop and this phone. Bots keep their own chats.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void run(props.onDelete) },
    ]);

  return (
    <Sheet visible={props.visible} onClose={props.onClose} title="Group">
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.label}>NAME</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            maxLength={64}
            style={styles.input}
            returnKeyType="done"
            onSubmitEditing={rename}
            onEndEditing={rename}
            accessibilityLabel="Group name"
            placeholderTextColor={colors.faint}
          />
        </View>

        <Text style={styles.label}>{`BOTS · ${props.members.length}/${MAX_MEMBERS}`}</Text>
        {props.members.map((member, index) => {
          const paused = props.held.has(member.name);
          return (
            // Desktop rooms can list a bot twice (legacy descriptors); position keeps keys unique.
            <View key={`${member.name}:${index}`} style={styles.member}>
              <BotAvatar name={member.name} size={36} />
              <View style={styles.flex}>
                <Text style={[type.heading, { color: botColor(member.name, colors) }]} numberOfLines={1}>
                  {props.displayName(member.name)}
                </Text>
                <Text style={type.small} numberOfLines={1}>
                  {paused ? "Paused. Won't reply until addressed" : `@${member.handle}`}
                  {!member.local && member.connectionLabel ? `  ·  ${member.connectionLabel}` : ""}
                </Text>
              </View>
              <IconButton
                icon={paused ? "play-circle-outline" : "pause-circle-outline"}
                label={paused ? `Resume ${props.displayName(member.name)}` : `Pause ${props.displayName(member.name)}`}
                color={paused ? colors.accentText : colors.muted}
                onPress={() => props.onHold(member, !paused)}
                disabled={props.busy}
              />
              {member.local && localNames.length > 1 ? (
                <IconButton icon="remove-circle-outline" label={`Remove ${props.displayName(member.name)}`} color={colors.muted} onPress={() => remove(member)} disabled={working} />
              ) : null}
            </View>
          );
        })}

        {addable.length && props.members.length < MAX_MEMBERS ? (
          <>
            <Text style={styles.label}>ADD A BOT</Text>
            <View style={styles.chips}>
              {addable.map((profile) => (
                <Chip
                  key={profile.name}
                  label={props.displayName(profile.name)}
                  icon="add"
                  onPress={() => void run(() => props.onSetMembers([...localNames, profile.name]))}
                />
              ))}
            </View>
          </>
        ) : null}

        <Button title="Delete group" variant="danger" icon="trash-outline" onPress={removeGroup} disabled={working} style={styles.delete} />
      </ScrollView>
    </Sheet>
  );
}

const useStyles = makeStyles((colors, type) => ({
  body: { paddingHorizontal: space.lg, gap: space.md, paddingBottom: space.lg },
  card: { backgroundColor: colors.raised, borderRadius: radius.lg, padding: space.md, gap: space.xs },
  label: { ...type.caption },
  input: { color: colors.text, fontSize: 17, paddingVertical: 6 },
  member: { flexDirection: "row", alignItems: "center", gap: space.md },
  flex: { flex: 1, minWidth: 0 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  delete: { marginTop: space.md },
}));
