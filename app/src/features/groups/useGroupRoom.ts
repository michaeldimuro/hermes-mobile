import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import { errorText, useGateway } from "@/lib/store/GatewayProvider";
import {
  buildTimeline,
  clientEventId,
  deriveActivity,
  latestSeq,
  mergeEvents,
  roomMembers,
  type TimelineItem,
} from "./groupEvents";
import type { DriverStatus, GroupEvent, GroupLogPage, GroupRoom, GroupStateResult } from "./types";

/** Hosted rooms have no client push channel (member activity only reaches plugin hooks), so the
 *  screen polls `groups.log` while focused: fast while bots are working, slow when idle. */
const BUSY_POLL_MS = 1500;
const IDLE_POLL_MS = 6000;
const ERROR_POLL_MS = 8000;
const LOG_PAGE = 200;
const MAX_PAGES_PER_TICK = 20;

type Outgoing = { key: string; text: string; createdAt: number };

const isGone = (error: unknown) => /not found|disbanded|4112|4114/i.test(errorText(error, ""));

export function useGroupRoom(roomId: string) {
  const { call, connection, showToast } = useGateway();
  const [room, setRoom] = useState<GroupRoom | null>(null);
  const [events, setEvents] = useState<GroupEvent[]>([]);
  const [driver, setDriver] = useState<DriverStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [gone, setGone] = useState(false);
  const [outbox, setOutbox] = useState<Outgoing[]>([]);

  const eventsRef = useRef<GroupEvent[]>([]);
  const busyRef = useRef(false);
  const fetching = useRef(false);
  const focused = useRef(false);
  const appActive = useRef(AppState.currentState !== "background");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ticks = useRef(0);
  const tickRef = useRef<() => void>(() => undefined);

  const members = useMemo(() => roomMembers(room), [room]);
  const activity = useMemo(() => deriveActivity(events, members), [events, members]);
  const busy = activity.pending || Boolean(driver?.working) || outbox.length > 0;
  useLayoutEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  // Reset when navigating between rooms: state during render, refs once committed.
  const [prevRoomId, setPrevRoomId] = useState(roomId);
  if (roomId !== prevRoomId) {
    setPrevRoomId(roomId);
    setEvents([]);
    setRoom(null);
    setDriver(null);
    setGone(false);
    setLoading(true);
  }
  useEffect(() => {
    eventsRef.current = [];
    ticks.current = 0;
  }, [roomId]);

  const fetchLog = useCallback(async () => {
    if (fetching.current) return;
    fetching.current = true;
    try {
      let since = latestSeq(eventsRef.current);
      const fresh: GroupEvent[] = [];
      for (let page = 0; page < MAX_PAGES_PER_TICK; page += 1) {
        const result = await call<GroupLogPage>("groups.log", { room_id: roomId, since_seq: since, limit: LOG_PAGE });
        fresh.push(...(result.events ?? []));
        if (!result.has_more || result.cursor <= since) break;
        since = result.cursor;
      }
      if (fresh.length) {
        eventsRef.current = mergeEvents(eventsRef.current, fresh);
        setEvents(eventsRef.current);
      }
    } finally {
      fetching.current = false;
    }
  }, [call, roomId]);

  const fetchState = useCallback(async () => {
    const result = await call<GroupStateResult>("groups.state", { room_id: roomId });
    setRoom(result.room);
    setDriver(result.driver_status ?? null);
  }, [call, roomId]);

  const schedule = useCallback((delay: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = focused.current && appActive.current ? setTimeout(() => tickRef.current(), delay) : null;
  }, []);

  // Timers call through tickRef so they always see this render's connection/gone/fetchers.
  useLayoutEffect(() => {
    tickRef.current = async () => {
      if (!focused.current || !appActive.current || gone) return;
      if (connection !== "open") return schedule(IDLE_POLL_MS);
      ticks.current += 1;
      try {
        await fetchLog();
        // Driver status (blocked turns, approvals) changes less often than the log.
        if (ticks.current === 1 || ticks.current % (busyRef.current ? 3 : 5) === 0) await fetchState();
        schedule(busyRef.current ? BUSY_POLL_MS : IDLE_POLL_MS);
      } catch (error) {
        if (isGone(error)) setGone(true);
        else schedule(ERROR_POLL_MS);
      } finally {
        setLoading(false);
      }
    };
  }, [connection, gone, fetchLog, fetchState, schedule]);

  const pollSoon = useCallback((delay = 250) => schedule(delay), [schedule]);

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      pollSoon(0);
      return () => {
        focused.current = false;
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
      };
    }, [pollSoon]),
  );

  // Resume immediately when the socket reopens or the app returns to the foreground; pause in background.
  useEffect(() => {
    if (connection === "open") pollSoon(0);
  }, [connection, pollSoon]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      appActive.current = state === "active";
      if (appActive.current) pollSoon(0);
      else if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    });
    return () => sub.remove();
  }, [pollSoon]);

  /** Continue whichever thread the room already uses (desktop may have started one); default to the room id. */
  const threadId = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const id = events[i].kind === "message.user" ? events[i].payload.thread_id : null;
      if (typeof id === "string" && id) return id;
    }
    return roomId;
  }, [events, roomId]);

  const send = useCallback(
    async (text: string) => {
      const body = text.trim();
      if (!body) return false;
      const key = clientEventId("mobile");
      setOutbox((list) => [...list, { key, text: body, createdAt: Date.now() / 1000 }]);
      try {
        const result = await call<{ event?: GroupEvent }>("groups.send", {
          room_id: roomId,
          event_id: key,
          payload: { text: body, thread_id: threadId },
        });
        if (result.event) {
          eventsRef.current = mergeEvents(eventsRef.current, [result.event]);
          setEvents(eventsRef.current);
        }
        return true;
      } catch (error) {
        showToast(errorText(error, "Message not sent"), "error");
        return false;
      } finally {
        setOutbox((list) => list.filter((item) => item.key !== key));
        pollSoon(600);
      }
    },
    [call, roomId, threadId, showToast, pollSoon],
  );

  const stop = useCallback(async () => {
    try {
      const result = await call<{ cancelled?: number }>("groups.stop", {
        room_id: roomId,
        cancel_id: clientEventId("mobile-stop"),
      });
      showToast(result.cancelled ? "Stopped the bots" : "Nothing was running", "success");
    } catch (error) {
      showToast(errorText(error, "Could not stop the room"), "error");
    } finally {
      pollSoon(300);
    }
  }, [call, roomId, showToast, pollSoon]);

  const rename = useCallback(
    async (name: string) => {
      const next = name.trim();
      if (!next || next === room?.name) return true;
      try {
        const result = await call<{ room: GroupRoom }>("groups.rename", {
          room_id: roomId,
          event_id: clientEventId("mobile-rename"),
          name: next,
        });
        setRoom(result.room);
        pollSoon(200);
        return true;
      } catch (error) {
        showToast(errorText(error, "Could not rename the room"), "error");
        return false;
      }
    },
    [call, roomId, room?.name, showToast, pollSoon],
  );

  const disband = useCallback(async () => {
    try {
      await call("groups.disband", { room_id: roomId }, 60_000);
      setGone(true);
      return true;
    } catch (error) {
      showToast(errorText(error, "Could not disband the room"), "error");
      return false;
    }
  }, [call, roomId, showToast]);

  const retry = useCallback(
    async (taskId: string) => {
      try {
        await call("groups.retry", { room_id: roomId, task_id: taskId });
        showToast("Retrying", "success");
      } catch (error) {
        showToast(errorText(error, "Could not retry"), "error");
      } finally {
        pollSoon(300);
      }
    },
    [call, roomId, showToast, pollSoon],
  );

  const approve = useCallback(
    async (action: Record<string, unknown>, choice: "once" | "deny") => {
      const memberId = typeof action.member_id === "string" ? action.member_id : activity.working?.id;
      if (!memberId) return showToast("Open Hermes on desktop to answer this approval", "warn");
      try {
        await call("groups.approve", {
          room_id: roomId,
          member_id: memberId,
          task_id: String(action.task_id ?? ""),
          execution_generation: Number(action.execution_generation ?? 0),
          choice,
          request_id: String(action.request_id ?? ""),
        });
      } catch (error) {
        showToast(errorText(error, "Approval failed"), "error");
      } finally {
        pollSoon(300);
      }
    },
    [call, roomId, activity.working, showToast, pollSoon],
  );

  const timeline = useMemo<TimelineItem[]>(() => {
    const items = buildTimeline(events, members);
    const base = latestSeq(events);
    outbox.forEach((item, i) =>
      items.push({ type: "user", key: item.key, seq: base + i + 1, text: item.text, createdAt: item.createdAt, pending: true }),
    );
    return items;
  }, [events, members, outbox]);

  return {
    room,
    members,
    timeline,
    activity,
    driver,
    loading,
    gone,
    sending: outbox.length > 0,
    send,
    stop,
    rename,
    disband,
    retry,
    approve,
    refresh: () => pollSoon(0),
  };
}
