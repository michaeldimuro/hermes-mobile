import React, { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useGateway } from "@/lib/store/GatewayProvider";
import { BotChips } from "@/features/settings/BotChips";
import { Button, Chip, Sheet } from "@/ui/primitives";
import { makeStyles, radius, space, useTheme } from "@/ui/theme";

/** Add a card to a board, optionally handing it straight to a bot (it goes to Ready). */
export function NewTaskSheet({
  visible,
  onClose,
  onCreate,
}: {
  visible: boolean;
  onClose: () => void;
  onCreate: (title: string, body: string, assignee: string | null) => Promise<string | null>;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { profiles } = useGateway();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [assignee, setAssignee] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    const failed = await onCreate(title.trim(), body.trim(), assignee);
    setBusy(false);
    if (failed) return;
    setTitle("");
    setBody("");
    setAssignee(null);
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="New task">
      <View style={styles.form}>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="What needs doing?"
          placeholderTextColor={colors.faint}
          style={styles.input}
          accessibilityLabel="Task title"
        />
        <TextInput
          value={body}
          onChangeText={setBody}
          placeholder="Details, links, acceptance criteria (optional)"
          placeholderTextColor={colors.faint}
          style={[styles.input, styles.body]}
          multiline
          accessibilityLabel="Task details"
        />
      </View>
      <Text style={styles.label}>ASSIGN TO</Text>
      <BotChips
        profiles={profiles}
        value={assignee}
        onChange={(name) => setAssignee(assignee === name ? null : name)}
        leading={<Chip label="Nobody yet" active={assignee === null} onPress={() => setAssignee(null)} />}
      />
      <View style={styles.actions}>
        <Button title="Create task" icon="add" onPress={create} loading={busy} disabled={!title.trim() || busy} />
      </View>
    </Sheet>
  );
}

const useStyles = makeStyles((colors, type) => ({
  form: { gap: space.sm, paddingHorizontal: space.lg },
  input: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 2,
    color: colors.text,
    fontSize: 16,
  },
  body: { minHeight: 90, maxHeight: 180, textAlignVertical: "top" },
  label: { ...type.caption, paddingHorizontal: space.lg, marginTop: space.lg, marginBottom: space.sm },
  actions: { padding: space.lg },
}));
