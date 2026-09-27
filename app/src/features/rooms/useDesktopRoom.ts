import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import { errorText, useGateway } from "@/lib/store/GatewayProvider";
import {
  buildRoomTimeline,
  candidatesFromSessions,
  memberSessionTitles,
  mergeByTime,
  mergeSessionReplies,
  parseGroupsEnvelope,
  readGroupsMeta,
  reconstructEarlier,
  resolveTruncated,
  toSessionRows,
  type MirrorEntry,
  type MirrorRoom,
  type SessionRow,
  type TimelineRow,
} from "./roomMirror";
import { serializeEnvelope } from "./engine/mirrorCodec";
import { onMirrorWrite } from "./engine/mirrorWrite";

const POLL_MS = 4_000;
const PAGE = 500;
const MAX_PAGES = 6;

const SESSION_REFRESH_MS = 30_000;

type SessionData = ReturnType<typeof candidatesFromSessions> & { fetchedAt: number };
const EMPTY_SESSIONS: SessionData = { replies: [], turns: [], userLines: [], fetchedAt: 0 };
type CachedSessions = { rows: SessionRow[]; fetchedAt: number; full: boolean };
type SessionRef = { id?: string; resolved_id?: string | null };
type MessagesPage = { messages?: unknown[] };

export type EarlierState = "idle" | "loading" | "done";

export type DesktopRoomState = {
  room: MirrorRoom | null;
  /** Oldest → newest display rows. */
  rows: TimelineRow[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  /** Loaded, but no room with this id exists (deleted or never mirrored). */
  notFound: boolean;
  /** Older messages the mirror does not carry. */
  omitted: number;
  earlierState: EarlierState;
  earlierCount: number;
  /** Replies found in member sessions but missing from the mirror, merged into `rows`. */
  mergedCount: number;
  refresh: () => Promise<void>;
  retry: () => void;
  loadEarlier: () => Promise<void>;
};

/** Plain names peers may be quoted under in room prompts (display labels are learned from the prompts). */
const speakerLabels = (target: MirrorRoom) => target.members.flatMap((m) => [m.name, m.handle]);

/** One Hermes desktop group chat, read-only, kept live while the screen is focused. */
const NO_EXTRA: MirrorEntry[] = [];

/** `extra`: optimistic entries (e.g. a send in flight) merged by id into the timeline. */
export function useDesktopRoom(roomId: string, extra: MirrorEntry[] = NO_EXTRA): DesktopRoomState {
  const { call, get, connection, showToast } = useGateway();
  const [room, setRoom] = useState<MirrorRoom | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(0);
  const [sessionData, setSessionData] = useState<SessionData | null>(null);
  const [earlier, setEarlier] = useState<MirrorEntry[]>([]);
  const [earlierState, setEarlierState] = useState<EarlierState>("idle");
  const revision = useRef<number | null>(null);
  const sessionCache = useRef(new Map<string, CachedSessions>());

  const loadOrReport = useCallback(
    (force: boolean, quiet: boolean) =>
      call<{ profiles?: unknown[] }>("profiles.list", { include_sessions: false }, 20_000)
        .then((result) => {
          const meta = readGroupsMeta(result.profiles);
          if (!force && meta.revision !== null && meta.revision === revision.current) return;
          revision.current = meta.revision;
          setRoom(parseGroupsEnvelope(meta.envelope).rooms.find((r) => r.roomId === roomId) ?? null);
          setNow(Date.now());
          setError(null);
        })
        .catch((err: unknown) => {
          const message = errorText(err, "Could not load this group chat");
          setError(message);
          if (!quiet) showToast(message, "error");
        })
        .finally(() => setLoaded(true)),
    [call, roomId, showToast],
  );

  // Writes from this device (sends, replies) land at once instead of on the next poll.
  useEffect(
    () =>
      onMirrorWrite((read) => {
        revision.current = read.revision;
        setRoom(parseGroupsEnvelope(serializeEnvelope(read.envelope)).rooms.find((r) => r.roomId === roomId) ?? null);
        setNow(Date.now());
        setError(null);
        setLoaded(true);
      }),
    [roomId],
  );

  // First load and every reconnect.
  useEffect(() => {
    if (connection === "open") void loadOrReport(true, false);
  }, [connection, loadOrReport]);

  // Live updates: poll the mirror revision while focused and in the foreground.
  useFocusEffect(
    useCallback(() => {
      if (connection !== "open") return;
      let timer: ReturnType<typeof setInterval> | null = null;
      const start = () => {
        if (!timer) timer = setInterval(() => void loadOrReport(false, true), POLL_MS);
      };
      const stop = () => {
        if (timer) clearInterval(timer);
        timer = null;
      };
      if (AppState.currentState === "active") start();
      const sub = AppState.addEventListener("change", (state) => {
        if (state === "active") {
          void loadOrReport(false, true);
          start();
        } else stop();
      });
      return () => {
        stop();
        sub.remove();
      };
    }, [connection, loadOrReport]),
  );

  /** Every local member's transcript(s) for this room, cached; `full` pages through the whole history. */
  const memberSessions = useCallback(
    async (target: MirrorRoom, opts: { full: boolean; newerThan: number }) => {
      const members = target.members.filter((m) => m.local);
      const titles = memberSessionTitles(target);
      return Promise.all(
        members.map(async (member) => {
          const cacheKey = `${target.roomId}\u0000${member.name}`;
          const cached = sessionCache.current.get(cacheKey);
          if (cached && (cached.full || !opts.full) && cached.fetchedAt >= opts.newerThan) return { member: member.name, rows: cached.rows };
          const ids = new Set<string>();
          for (const title of titles) {
            try {
              const found = await call<{ sessions?: SessionRef[] }>(
                "session.list",
                { profile: member.name, title, include_hidden: true, limit: 5 },
                15_000,
              );
              for (const s of found.sessions ?? []) if (s.resolved_id || s.id) ids.add(String(s.resolved_id || s.id));
            } catch {
              // A member without a session for this title is normal.
            }
          }
          const rows: SessionRow[] = [];
          const profile = encodeURIComponent(member.name);
          for (const id of ids) {
            const base = `/api/sessions/${encodeURIComponent(id)}/messages?profile=${profile}`;
            if (!opts.full) {
              const page = await get<MessagesPage>(base);
              rows.push(...toSessionRows(page.messages));
              continue;
            }
            for (let i = 0; i < MAX_PAGES; i++) {
              const page = await get<MessagesPage>(`${base}&limit=${PAGE}&offset=${i * PAGE}&order=oldest&include_compacted=true`);
              const list = page.messages ?? [];
              rows.push(...toSessionRows(list));
              if (list.length < PAGE) break;
            }
          }
          rows.sort((a, b) => a.at - b.at);
          sessionCache.current.set(cacheKey, { rows, fetchedAt: Date.now(), full: opts.full });
          return { member: member.name, rows };
        }),
      );
    },
    [call, get],
  );

  // Member transcripts back full texts and replies missing from the mirror. They are refetched only
  // when the mirror changes (new room object), and at most every SESSION_REFRESH_MS.
  const lastSessionFetch = useRef(0);
  const hasLocalMembers = Boolean(room?.members.some((m) => m.local));
  useEffect(() => {
    if (!room || !hasLocalMembers || connection !== "open") return;
    const run = () => {
      lastSessionFetch.current = Date.now();
      memberSessions(room, { full: false, newerThan: lastSessionFetch.current })
        .then((sessions) => setSessionData({ ...candidatesFromSessions(sessions, speakerLabels(room)), fetchedAt: Date.now() }))
        .catch(() => setSessionData((prev) => ({ ...(prev ?? EMPTY_SESSIONS), fetchedAt: Date.now() })));
    };
    const timer = setTimeout(run, Math.max(0, lastSessionFetch.current + SESSION_REFRESH_MS - Date.now()));
    return () => clearTimeout(timer);
  }, [room, hasLocalMembers, connection, memberSessions]);

  // Truncated entry → full text, or null once transcripts newer than it had no match.
  const fullTexts = useMemo(() => {
    const out: Record<string, string | null> = {};
    if (!room || !sessionData) return out;
    const resolved = resolveTruncated(room.log, [...sessionData.replies, ...sessionData.userLines]);
    for (const entry of room.log) {
      if (!entry.truncated) continue;
      if (resolved[entry.id]) out[entry.id] = resolved[entry.id];
      else if (sessionData.fetchedAt >= entry.at) out[entry.id] = null;
    }
    return out;
  }, [room, sessionData]);

  const merged = useMemo(() => (room && sessionData ? mergeSessionReplies(room.log, sessionData.turns) : []), [room, sessionData]);

  const loadEarlier = useCallback(async () => {
    if (!room || earlierState === "loading") return;
    setEarlierState("loading");
    try {
      const sessions = await memberSessions(room, { full: true, newerThan: 0 });
      const { turns, userLines } = candidatesFromSessions(sessions, speakerLabels(room));
      const found = reconstructEarlier(room.log, turns, userLines, room.roomId);
      // The full history is a superset of the latest page: reuse it for full texts and merging too.
      setSessionData({ ...candidatesFromSessions(sessions, speakerLabels(room)), fetchedAt: Date.now() });
      setEarlier(found);
      setEarlierState("done");
      if (!found.length) showToast("No earlier messages could be recovered", "info");
    } catch (err) {
      setEarlierState("idle");
      showToast(errorText(err, "Could not load earlier messages"), "error");
    }
  }, [room, earlierState, memberSessions, showToast]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await loadOrReport(true, false);
    setRefreshing(false);
  }, [loadOrReport]);

  const retry = useCallback(() => void loadOrReport(true, false), [loadOrReport]);

  const rows = useMemo(() => {
    if (!room) return [];
    const first = room.log.length ? room.log[0].at : Number.POSITIVE_INFINITY;
    const older = earlier.filter((e) => e.at < first);
    const known = new Set([...room.log, ...merged].map((e) => e.id));
    const entries = mergeByTime(older, room.log, merged, extra.filter((e) => !known.has(e.id)));
    return buildRoomTimeline(entries, { now, fullTexts, resolving: connection === "open" && hasLocalMembers });
  }, [room, earlier, merged, extra, now, fullTexts, connection, hasLocalMembers]);

  return {
    room,
    rows,
    loading: !loaded,
    refreshing,
    error,
    notFound: loaded && !error && !room,
    omitted: room?.omitted ?? 0,
    earlierState,
    earlierCount: earlier.length,
    mergedCount: merged.length,
    refresh,
    retry,
    loadEarlier,
  };
}
