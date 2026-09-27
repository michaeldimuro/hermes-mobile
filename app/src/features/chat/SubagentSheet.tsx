import React, { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { errorText } from "@/lib/store/GatewayProvider";
import { Button, haptic, Sheet } from "@/ui/primitives";
import { makeStyles, radius, space, useTheme } from "@/ui/theme";
import type { Subagent } from "./chatReducer";
import { toolLabel } from "./ThinkingBlock";

/** Session-scoped RPC for the chat's live session (the chat hook fills in `session_id`). */
export type SubagentRpc = <T>(method: string, params: Record<string, unknown>) => Promise<T>;

const TAIL_EVERY_MS = 1500;
const isDone = (status: string) => /complete|done|success|finished|cancel|fail|error|interrupt/i.test(status);

/**
 * One delegated sub-agent up close: its live transcript tail, a box to steer it mid-task, and a
 * stop button. Steering and stopping only reach children of turns this Hermes process runs.
 */
export function SubagentSheet({ agent, onClose, rpc }: { agent: Subagent | null; onClose: () => void; rpc: SubagentRpc }) {
  const styles = useStyles();
  const { colors, type } = useTheme();
  const [tail, setTail] = useState<{ text: string; available: boolean } | null>(null);
  const [steer, setSteer] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const id = agent?.id;
  const done = agent ? isDone(agent.status) : true;

  // Poll the live transcript while the sheet is open and the child is still working.
  useEffect(() => {
    if (!id) return;
    let alive = true;
    const pull = () =>
      rpc<{ text?: string; available?: boolean }>("subagent.tail", { subagent_id: id })
        .then((result) => alive && setTail({ text: result.text ?? "", available: Boolean(result.available) }))
        .catch(() => alive && setTail((current) => current ?? { text: "", available: false }));
    void pull();
    const timer = done ? undefined : setInterval(pull, TAIL_EVERY_MS);
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, [id, done, rpc]);

  const close = () => {
    setTail(null);
    setSteer("");
    setNote("");
    onClose();
  };

  const sendSteer = async () => {
    const text = steer.trim();
    if (!text || !id) return;
    setBusy(true);
    try {
      const result = await rpc<{ status?: string }>("subagent.steer", { subagent_id: id, text });
      if (result.status === "queued") {
        haptic.success();
        setSteer("");
        setNote("Sent. It picks this up after its current step.");
      } else setNote("It can't take directions right now (finished, or started on another device).");
    } catch (error) {
      setNote(errorText(error, "Could not steer"));
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    if (!id) return;
    setBusy(true);
    try {
      const result = await rpc<{ found?: boolean }>("subagent.interrupt", { subagent_id: id });
      haptic.warn();
      setNote(result.found ? "Stopping…" : "It already finished.");
    } catch (error) {
      setNote(errorText(error, "Could not stop"));
    } finally {
      setBusy(false);
    }
  };

  const meta = agent
    ? [agent.status, agent.model, agent.lastTool && `using ${toolLabel(agent.lastTool)}`, agent.toolCount && `${agent.toolCount} tools`]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <Sheet visible={Boolean(agent)} onClose={close} title="Sub-agent">
      {agent ? (
        <View style={styles.body}>
          <Text style={type.heading}>{agent.goal}</Text>
          <Text style={type.small}>{meta}</Text>
          <ScrollView
            ref={scroll}
            style={styles.tail}
            contentContainerStyle={styles.tailContent}
            onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
          >
            <Text selectable style={[type.mono, styles.tailText]}>
              {tail === null
                ? "Loading…"
                : tail.available && tail.text.trim()
                  ? tail.text.trim()
                  : agent.summary || (done ? "Finished." : "No live output yet.")}
            </Text>
          </ScrollView>
          {!done ? (
            <>
              <TextInput
                value={steer}
                onChangeText={setSteer}
                placeholder="Redirect it, e.g. “focus on pricing first”"
                placeholderTextColor={colors.faint}
                style={styles.input}
                multiline
                accessibilityLabel="Steer this sub-agent"
              />
              <View style={styles.row}>
                <Button title="Stop" variant="danger" icon="stop-circle-outline" onPress={stop} disabled={busy} style={styles.flex} />
                <Button title="Send" icon="navigate-outline" onPress={sendSteer} disabled={busy || !steer.trim()} style={styles.flex} />
              </View>
            </>
          ) : null}
          {note ? <Text style={type.small}>{note}</Text> : null}
        </View>
      ) : null}
    </Sheet>
  );
}

const useStyles = makeStyles((colors) => ({
  body: { gap: space.md, paddingBottom: space.md },
  tail: {
    maxHeight: 280,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  tailContent: { padding: space.md },
  tailText: { color: colors.textSoft, lineHeight: 18 },
  input: {
    minHeight: 44,
    maxHeight: 120,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    color: colors.text,
    fontSize: 15,
  },
  row: { flexDirection: "row", gap: space.sm },
  flex: { flex: 1 },
}));
