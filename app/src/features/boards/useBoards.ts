import { useCallback, useEffect, useState } from "react";
import { readCache, writeCache } from "@/lib/store/offlineCache";
import { useFocusEffect } from "expo-router";
import { errorText, useGateway } from "@/lib/store/GatewayProvider";
import type { Board, BoardSummary, KanbanTask, TaskDetail } from "./types";

const API = "/api/plugins/kanban";
const q = (board: string) => `board=${encodeURIComponent(board)}`;
/** Boards change while agents work; refresh on this cadence while a board screen is in view. */
const POLL_MS = 15_000;

/** Load `path` now, on focus, and every POLL_MS while focused. State only changes in callbacks. */
function usePolled<T>(path: string | null) {
  const { get } = useGateway();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    () =>
      path
        ? get<T>(path)
            .then((next) => {
              setData(next);
              setError(null);
            })
            .catch((err) => setError(errorText(err, "Could not load the board")))
            .finally(() => setRefreshing(false))
        : Promise.resolve(),
    [get, path],
  );

  useFocusEffect(
    useCallback(() => {
      void load();
      const timer = setInterval(() => void load(), POLL_MS);
      return () => clearInterval(timer);
    }, [load]),
  );

  const refresh = useCallback(() => {
    setRefreshing(true);
    void load();
  }, [load]);

  return { data, error, refreshing, refresh, reload: load };
}

/**
 * Every board, remembered on the phone. Hermes 0.21.5's list route can hang (the single-board route
 * doesn't), so when the list fails the last known boards are refreshed one by one instead.
 */
export function useBoardList() {
  const { get } = useGateway();
  const polled = usePolled<{ boards: BoardSummary[]; current: string }>(`${API}/boards`);
  const [fallback, setFallback] = useState<BoardSummary[] | null>(null);
  const live = polled.data?.boards;

  useEffect(() => {
    if (live?.length) void writeCache("boards", live);
  }, [live]);

  useEffect(() => {
    if (!polled.error || live) return;
    let alive = true;
    void readCache<BoardSummary[]>("boards").then(async (known) => {
      if (!known?.length) return;
      const fresh = await Promise.all(
        known.map((board) =>
          get<Board>(`${API}/board?${q(board.slug)}`)
            .then((data): BoardSummary => {
              const counts = Object.fromEntries(data.columns.map((c) => [c.name, c.tasks.length]));
              const total = Object.entries(counts).reduce((sum, [status, n]) => (status === "archived" ? sum : sum + n), 0);
              return { ...board, counts, total };
            })
            .catch(() => board),
        ),
      );
      if (alive) setFallback(fresh);
    });
    return () => {
      alive = false;
    };
  }, [get, live, polled.error]);

  const boards = live ?? fallback ?? [];
  return {
    ...polled,
    // With remembered boards on screen, a failed list call isn't worth an error state.
    error: boards.length ? null : polled.error,
    data: polled.data ?? (fallback ? { boards: fallback, current: "" } : null),
    boards,
    current: polled.data?.current,
  };
}

export function useBoard(slug: string) {
  return usePolled<Board>(`${API}/board?${q(slug)}`);
}

export function useTask(slug: string, id: string) {
  return usePolled<TaskDetail>(`${API}/tasks/${encodeURIComponent(id)}?${q(slug)}`);
}

/** Writes against one board. Each resolves with an error message (or null) for the caller to show. */
export function useBoardActions(slug: string) {
  const { get, showToast } = useGateway();
  const send = useCallback(
    async (path: string, method: string, body: unknown, done?: string) => {
      try {
        await get(`${API}${path}${path.includes("?") ? "&" : "?"}${q(slug)}`, { method, body: JSON.stringify(body) });
        if (done) showToast(done, "success");
        return null;
      } catch (error) {
        const text = errorText(error, "The board refused that change");
        showToast(text, "error");
        return text;
      }
    },
    [get, showToast, slug],
  );
  const id = (task: KanbanTask) => encodeURIComponent(task.id);
  return {
    move: (task: KanbanTask, status: string) => send(`/tasks/${id(task)}`, "PATCH", { status }, "Task moved"),
    assign: (task: KanbanTask, profile: string | null) =>
      send(`/tasks/${id(task)}/reassign`, "POST", { profile, reason: "Reassigned from Hermes Mobile" }, "Task reassigned"),
    comment: (task: KanbanTask, body: string) => send(`/tasks/${id(task)}/comments`, "POST", { body, author: "you" }),
    create: (title: string, body: string, assignee: string | null) =>
      send(`/tasks`, "POST", { title, body: body || null, assignee, triage: false }, "Task created"),
  };
}
