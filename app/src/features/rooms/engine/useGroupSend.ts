import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errorText, useGateway } from "@/lib/store/GatewayProvider";
import type { ProfileRow, ServerRequest } from "@/lib/gateway/types";
import { botHandle as profileHandle, botModeTitle } from "@/features/chat/mentions";
import type { MirrorEntry } from "../roomMirror";
import type { RawEntry } from "./mirrorCodec";
import { createDesktopRoom } from "./roomCreate";
import { createGroupRunner, type GroupRunner, type RunnerProgress } from "./roundRunner";
import type { EngineMember } from "./roundPrompt";

/** This gateway's profiles as engine members (friendly identity for tags, labels and prompts). */
export function rosterFromProfiles(profiles: ProfileRow[]): EngineMember[] {
  return profiles.map((row) => {
    const previous = (row as { previous_names?: unknown }).previous_names;
    return {
      name: row.name,
      handle: profileHandle(row),
      ...(botModeTitle(row) ? { title: botModeTitle(row) } : {}),
      ...(row.display_name ? { display_name: row.display_name } : {}),
      ...(Array.isArray(previous) ? { previous_names: previous.filter((p): p is string => typeof p === "string") } : {}),
    };
  });
}

const toMirrorEntry = (entry: RawEntry): MirrorEntry => ({
  id: entry.id ?? `pending:${entry.at}`,
  from: { kind: entry.from.kind, name: entry.from.name, ...(entry.from.source ? { source: entry.from.source } : {}) },
  text: entry.text,
  at: entry.at,
  ...(entry.thread ? { thread: entry.thread } : {}),
});

export type GroupSend = {
  send: (text: string, thread: string | null /* null = new thread */) => Promise<void>;
  stop: () => void;
  busy: boolean;
  progress: { member?: string; round?: number; note?: string } | null;
  pending: MirrorEntry[];
  requests: ServerRequest[];
  answer: (id: string, result: Record<string, unknown>) => void;
  decline: (id: string) => void;
};

/** Post into a desktop group chat and run its bot round from the phone, desktop-compatible. */
export function useGroupSend(roomId: string): GroupSend {
  const { client, call, profiles, showToast } = useGateway();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<RunnerProgress>(null);
  const [pending, setPending] = useState<MirrorEntry[]>([]);
  const [requests, setRequests] = useState<ServerRequest[]>([]);
  const runner = useRef<GroupRunner | null>(null);
  const sessions = useRef(new Set<string>());
  const roster = useMemo(() => rosterFromProfiles(profiles), [profiles]);

  // Clarify / approval requests raised inside the member sessions this drive runs.
  useEffect(() => {
    if (!client) return;
    return client.onRequest((request) => {
      const sid = request.params?.session_id;
      if (typeof sid !== "string" || !sessions.current.has(sid)) return;
      setRequests((list) => (list.some((r) => r.id === request.id) ? list : [...list, request]));
    });
  }, [client]);

  const send = useCallback(
    async (text: string, thread: string | null) => {
      const body = text.trim();
      if (!body || runner.current) return;
      if (!client) {
        showToast("Not connected to Hermes", "error");
        return;
      }
      const current = createGroupRunner(
        { call, onEvent: (listener) => client.onEvent(listener) },
        {
          onProgress: (next) => setProgress(next),
          onNotice: (note) => {
            setProgress((prev) => ({ ...(prev ?? {}), note }));
            showToast(note, "warn");
          },
          onPending: (entries) => setPending((list) => [...list, ...entries.map(toMirrorEntry)]),
          onWritten: (entries) => {
            const ids = new Set(entries.map((e) => e.id));
            setPending((list) => list.filter((e) => !ids.has(e.id)));
          },
          onSession: (sid, _member, isActive) => {
            if (isActive) {
              sessions.current.add(sid);
              client.track(sid);
            } else {
              sessions.current.delete(sid);
              client.untrack(sid);
              setRequests((list) => list.filter((r) => r.params?.session_id !== sid));
            }
          },
        },
      );
      runner.current = current;
      setBusy(true);
      try {
        await current.drive({ roomId, thread, text: body, roster });
      } catch (error) {
        showToast(errorText(error, "Could not send to the group"), "error");
      } finally {
        runner.current = null;
        setBusy(false);
        setProgress(null);
        setPending([]);
        setRequests([]);
      }
    },
    [call, client, roomId, roster, showToast],
  );

  const stop = useCallback(() => {
    runner.current?.stop();
    setProgress((prev) => ({ ...(prev ?? {}), note: "Stopping after this reply…" }));
  }, []);

  const answer = useCallback(
    (id: string, result: Record<string, unknown>) => {
      client?.respond(id, result);
      setRequests((list) => list.filter((r) => r.id !== id));
    },
    [client],
  );

  const decline = useCallback(
    (id: string) => {
      client?.decline(id);
      setRequests((list) => list.filter((r) => r.id !== id));
    },
    [client],
  );

  return { send, stop, busy, progress, pending, requests, answer, decline };
}

/** Creates a Hermes desktop group chat (unique name, desktop member descriptors, one CAS write). */
export function useCreateDesktopRoom(): (input: { name: string; members: string[] }) => Promise<{ roomId: string; name: string }> {
  const { call, profiles, showToast } = useGateway();
  return useCallback(
    async (input: { name: string; members: string[] }) => {
      const handleFor = (name: string) => {
        const row = profiles.find((p) => p.name === name);
        return row ? profileHandle(row) : name.trim().toLowerCase() === "default" ? "hermes" : name;
      };
      const created = await createDesktopRoom(call, input, handleFor);
      if (created.failedMeta.length) showToast(`Group created, but ${created.failedMeta.join(", ")} didn't record it`, "warn");
      return { roomId: created.roomId, name: created.name };
    },
    [call, profiles, showToast],
  );
}
