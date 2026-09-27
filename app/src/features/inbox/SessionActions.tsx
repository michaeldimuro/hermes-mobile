import React, { useCallback, useState } from "react";
import { Alert, Text, TextInput, View } from "react-native";
import { errorText, useGateway } from "@/lib/store/GatewayProvider";
import type { SessionListRow, SessionOpenResult } from "@/lib/gateway/types";
import { Button, haptic, Icon, PressableRow, Sheet } from "@/ui/primitives";
import { makeStyles, radius, space, useTheme } from "@/ui/theme";
import { previewText } from "./format";
import { deleteErrorText, sessionKey } from "./grouping";

const displayTitle = (row: SessionListRow) => row.title || previewText(row.preview) || "Untitled session";

/** Optimistic delete and rename for session rows, layered over the fetched list. */
export function useSessionMutations() {
  const { call, get, showToast } = useGateway();
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const [titles, setTitles] = useState<Readonly<Record<string, string>>>({});
  const [pinned, setPinned] = useState<Readonly<Record<string, boolean>>>({});

  /** Hermes's own session pin (synced with desktop; also exempts it from auto-archive). */
  const togglePinned = useCallback(
    async (row: SessionListRow) => {
      const key = sessionKey(row);
      const next = !(key in pinned ? pinned[key] : row.pinned);
      setPinned((current) => ({ ...current, [key]: next }));
      try {
        await get(`/api/sessions/${encodeURIComponent(row.id)}?profile=${encodeURIComponent(row.profile ?? "default")}`, {
          method: "PATCH",
          body: JSON.stringify({ pinned: next }),
        });
        haptic.success();
      } catch (error) {
        setPinned((current) => ({ ...current, [key]: !next }));
        showToast(errorText(error, "Could not pin the session"), "error");
      }
    },
    [get, pinned, showToast],
  );

  const remove = useCallback(
    async (row: SessionListRow) => {
      const key = sessionKey(row);
      const profile = row.profile ?? "default";
      setHidden((current) => new Set(current).add(key));
      try {
        // Hermes refuses to delete a live session: attach, close the runtime, then delete the stored one.
        try {
          const live = await call<SessionOpenResult>("session.resume", { session_id: row.id, profile, omit_messages: true });
          if (live?.session_id) await call("session.close", { session_id: live.session_id }).catch(() => undefined);
        } catch {
          // Nothing live to close; the delete below reports the real problem, if any.
        }
        await call("session.delete", { session_id: row.id, profile });
        haptic.success();
      } catch (error) {
        setHidden((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
        haptic.warn();
        showToast(deleteErrorText(error), "error");
      }
    },
    [call, showToast],
  );

  const confirmDelete = useCallback(
    (row: SessionListRow, close: () => void) => {
      haptic.warn();
      Alert.alert("Delete this session?", `"${displayTitle(row)}" will be removed from Hermes on every device.`, [
        { text: "Cancel", style: "cancel", onPress: close },
        { text: "Delete", style: "destructive", onPress: () => void remove(row) },
      ]);
    },
    [remove],
  );

  const rename = useCallback(
    async (row: SessionListRow, title: string) => {
      const key = sessionKey(row);
      const profile = row.profile ?? "default";
      const had = key in titles;
      const previous = titles[key];
      setTitles((current) => ({ ...current, [key]: title }));
      try {
        await get(`/api/sessions/${encodeURIComponent(row.id)}?profile=${encodeURIComponent(profile)}`, {
          method: "PATCH",
          body: JSON.stringify({ title }),
        });
        haptic.success();
        return true;
      } catch (error) {
        setTitles((current) => {
          const next = { ...current };
          if (had) next[key] = previous;
          else delete next[key];
          return next;
        });
        showToast(errorText(error, "Could not rename the session"), "error");
        return false;
      }
    },
    [get, showToast, titles],
  );

  return { hidden, titles, pinned, togglePinned, remove, confirmDelete, rename };
}

/** Long-press menu for a session: Rename (inline field) and Delete. */
export function SessionActionSheet({
  target,
  visible,
  onClose,
  onRename,
  onDelete,
  onTogglePin,
}: {
  target: SessionListRow | null;
  visible: boolean;
  onClose: () => void;
  onRename: (row: SessionListRow, title: string) => Promise<boolean>;
  onDelete: (row: SessionListRow, close: () => void) => void;
  onTogglePin?: (row: SessionListRow) => void;
}) {
  const styles = useStyles();
  const { colors, scheme } = useTheme();
  const [mode, setMode] = useState<"menu" | "rename">("menu");
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  // Every open starts on the menu with the current title, even when reopening the same row.
  const opened = visible ? target : null;
  const [seen, setSeen] = useState<SessionListRow | null>(null);
  if (opened !== seen) {
    setSeen(opened);
    if (opened) {
      setMode("menu");
      setDraft(opened.title ?? "");
    }
  }

  const trimmed = draft.trim();
  const save = async () => {
    if (!target || !trimmed) return;
    setSaving(true);
    const ok = await onRename(target, trimmed);
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={mode === "rename" ? "Rename session" : target ? displayTitle(target) : undefined}>
      {mode === "rename" ? (
        <View style={styles.rename}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Session title"
            placeholderTextColor={colors.faint}
            keyboardAppearance={scheme}
            autoFocus
            selectTextOnFocus
            returnKeyType="done"
            onSubmitEditing={() => void save()}
            maxLength={120}
            style={styles.input}
            accessibilityLabel="Session title"
          />
          <Button title="Save" onPress={() => void save()} loading={saving} disabled={!trimmed || trimmed === target?.title} />
        </View>
      ) : (
        <>
          <PressableRow accessibilityRole="button" onPress={() => setMode("rename")} style={styles.option}>
            <Icon name="pencil-outline" size={20} color={colors.text} />
            <Text style={styles.optionText}>Rename</Text>
          </PressableRow>
          {onTogglePin ? (
            <PressableRow
              accessibilityRole="button"
              onPress={() => {
                if (!target) return;
                onClose();
                onTogglePin(target);
              }}
              style={styles.option}
            >
              <Icon name={target?.pinned ? "pin-outline" : "pin"} size={20} color={colors.text} />
              <Text style={styles.optionText}>{target?.pinned ? "Unpin" : "Pin to top"}</Text>
            </PressableRow>
          ) : null}
          <PressableRow
            accessibilityRole="button"
            onPress={() => {
              if (!target) return;
              onClose();
              onDelete(target, () => undefined);
            }}
            style={styles.option}
          >
            <Icon name="trash-outline" size={20} color={colors.danger} />
            <Text style={[styles.optionText, { color: colors.danger }]}>Delete</Text>
          </PressableRow>
        </>
      )}
    </Sheet>
  );
}

const useStyles = makeStyles((colors) => ({
  option: { marginHorizontal: space.sm },
  optionText: { color: colors.text, fontSize: 16, fontWeight: "500" },
  rename: { gap: space.md, paddingHorizontal: space.lg, paddingBottom: space.sm },
  input: {
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: space.md,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
}));
