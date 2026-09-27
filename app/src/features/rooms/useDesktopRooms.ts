import { useCallback, useEffect, useRef, useState } from "react";
import { readCache, writeCache } from "@/lib/store/offlineCache";
import { AppState } from "react-native";
import { useGateway } from "@/lib/store/GatewayProvider";
import { parseGroupsEnvelope, readGroupsMeta, summarizeEnvelope } from "./roomMirror";
import { serializeEnvelope } from "./engine/mirrorCodec";
import { onMirrorWrite } from "./engine/mirrorWrite";

export type DesktopRoomSummary = {
  roomId: string; // route param for /room/[roomId]
  name: string;
  members: { name: string; handle: string }[]; // name = Hermes profile name
  last?: { from: string; kind: "user" | "member"; text: string; at: number /* ms */ };
  updatedAt: number; // ms, last activity (last message at, else envelope updatedAt)
};

/** Background refresh cadence for the inbox (never faster than 15s). */
const POLL_MS = 30_000;

/** The Hermes desktop group chats mirrored on the gateway, newest activity first. */
export function useDesktopRooms(): { rooms: DesktopRoomSummary[]; loading: boolean; refresh: () => Promise<void> } {
  const { call, connection } = useGateway();
  const [rooms, setRooms] = useState<DesktopRoomSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const revision = useRef<number | null>(null);

  const load = useCallback(
    (force: boolean) =>
      call<{ profiles?: unknown[] }>("profiles.list", { include_sessions: false })
        .then((result) => {
          const meta = readGroupsMeta(result.profiles);
          if (!force && meta.revision !== null && meta.revision === revision.current) return;
          revision.current = meta.revision;
          const next = summarizeEnvelope(parseGroupsEnvelope(meta.envelope));
          setRooms(next);
          void writeCache("rooms", next);
        })
        .catch(() => undefined) // keep the last good list; the connection banner explains outages
        .finally(() => setLoading(false)),
    [call],
  );

  const refresh = useCallback(() => load(true), [load]);

  // Last known groups until the gateway answers (instant start, offline reading).
  useEffect(() => {
    void readCache<DesktopRoomSummary[]>("rooms").then((cached) => {
      if (cached?.length) setRooms((current) => (current.length ? current : cached));
    });
  }, []);

  // Writes from this device update the list at once.
  useEffect(
    () =>
      onMirrorWrite((read) => {
        revision.current = read.revision;
        setRooms(summarizeEnvelope(parseGroupsEnvelope(serializeEnvelope(read.envelope))));
      }),
    [],
  );

  // Initial load and every reconnect.
  useEffect(() => {
    if (connection === "open") void load(true);
  }, [connection, load]);

  // Gentle background refresh while the app is in the foreground.
  useEffect(() => {
    if (connection !== "open") return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (!timer) timer = setInterval(() => void load(false), POLL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    if (AppState.currentState === "active") start();
    const sub = AppState.addEventListener("change", (state) => (state === "active" ? start() : stop()));
    return () => {
      stop();
      sub.remove();
    };
  }, [connection, load]);

  return { rooms, loading: loading && connection !== "closed", refresh };
}
