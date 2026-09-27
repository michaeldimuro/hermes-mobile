import { useCallback, useEffect, useState } from "react";
import { errorText, useGateway } from "@/lib/store/GatewayProvider";
import type { SubagentRpc } from "./SubagentSheet";

export type GoalState = {
  title: string;
  status: string;
  turns_used: number;
  max_turns: number;
  subgoals: string[];
  paused_reason?: string | null;
  last_reason?: string | null;
};
export type LoopState = {
  prompt: string;
  status: string;
  interval_seconds: number;
  ticks_fired: number;
  next_due_at: number;
  times: number;
  until: string;
};
export type HeartbeatState = { prompt: string; status: string; interval_seconds: number; fire_count: number };
export type ControlSnapshot = { goal: GoalState | null; loop: LoopState | null; heartbeat: HeartbeatState | null };

export type ControlAction =
  | "goal.pause"
  | "goal.resume"
  | "goal.clear"
  | "loop.pause"
  | "loop.resume"
  | "loop.stop"
  | "heartbeat.pause"
  | "heartbeat.resume"
  | "heartbeat.clear";

const EMPTY: ControlSnapshot = { goal: null, loop: null, heartbeat: null };

/**
 * The session's standing goal, recurring loop and heartbeat (`session.control.read`), kept fresh
 * by `session.control.update` events and turn ends. Only reads once the chat has a stored session,
 * so opening a blank chat never creates one.
 */
export function useSessionControl({
  rpc,
  liveSessionId,
  enabled,
}: {
  rpc: SubagentRpc;
  liveSessionId: () => string | null;
  enabled: boolean;
}) {
  const { client, showToast } = useGateway();
  const [control, setControl] = useState<ControlSnapshot>(EMPTY);

  const read = useCallback(
    () =>
      rpc<{ control?: ControlSnapshot }>("session.control.read", {})
        .then((result) => setControl({ ...EMPTY, ...(result.control ?? {}) }))
        .catch(() => undefined),
    [rpc],
  );

  useEffect(() => {
    if (enabled) void read();
  }, [enabled, read]);

  useEffect(() => {
    if (!client || !enabled) return;
    return client.onEvent((event) => {
      if (event.session_id && event.session_id !== liveSessionId()) return;
      if (event.type === "session.control.update" || event.type === "message.complete") void read();
    });
  }, [client, enabled, liveSessionId, read]);

  const act = useCallback(
    async (action: ControlAction) => {
      try {
        const result = await rpc<{ control?: ControlSnapshot }>("session.control", { action });
        setControl({ ...EMPTY, ...(result.control ?? {}) });
      } catch (error) {
        showToast(errorText(error, "Could not change that"), "error");
      }
    },
    [rpc, showToast],
  );

  return { control, act, refresh: read };
}

/** "every 10m", "every 2h", "every 45s". */
export function everyText(seconds: number) {
  if (!seconds || seconds < 0) return "";
  if (seconds % 3600 === 0) return `every ${seconds / 3600}h`;
  if (seconds >= 60 && seconds % 60 === 0) return `every ${seconds / 60}m`;
  return `every ${Math.round(seconds)}s`;
}
