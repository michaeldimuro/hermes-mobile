import { useCallback, useEffect, useRef, useState } from "react";
import { readCache, writeCache } from "@/lib/store/offlineCache";
import { useGateway } from "@/lib/store/GatewayProvider";
import type { SessionListRow } from "@/lib/gateway/types";

const PAGE = 40;

/** Hermes session `source` values grouped the way people think about them. */
export const SESSION_FILTERS = [
  { id: "all", label: "All", query: "exclude_sources=kanban,tool,oneshot,subagent" },
  { id: "chats", label: "Chats", query: "sources=mobile,desktop,tui,cli" },
  { id: "channels", label: "Channels", query: "sources=discord,telegram,slack,mattermost,matrix,signal,whatsapp,email,webhook,sms" },
  { id: "automations", label: "Automations", query: "source=cron" },
  { id: "tasks", label: "Tasks", query: "sources=kanban,subagent" },
] as const;
export type SessionFilterId = (typeof SESSION_FILTERS)[number]["id"];

type Page = { sessions?: SessionListRow[]; total?: number };

/**
 * Every session across every bot, newest first — one flat list, not grouped by bot
 * (`GET /api/profiles/sessions?profile=all` merges each profile's store and tags rows with `profile`).
 */
export function useAllSessions(enabled: boolean, filter: SessionFilterId) {
  const { get, connection } = useGateway();
  const [rows, setRows] = useState<SessionListRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState<number | null>(null);
  const request = useRef(0);

  const fetchPage = useCallback(
    (offset: number) => {
      const id = ++request.current;
      const scope = SESSION_FILTERS.find((item) => item.id === filter)?.query ?? "";
      const path = `/api/profiles/sessions?profile=all&order=recent&min_messages=1&archived=exclude&limit=${PAGE}&offset=${offset}&${scope}`;
      return Promise.resolve()
        .then(() => get<Page>(path))
        .then((page) => {
          if (id !== request.current) return;
          const fresh = page.sessions ?? [];
          setRows((current) => {
            const merged = new Map((offset ? current : []).map((row) => [`${row.profile}:${row.id}`, row]));
            for (const row of fresh) merged.set(`${row.profile}:${row.id}`, row);
            return [...merged.values()];
          });
          setTotal(typeof page.total === "number" ? page.total : null);
          if (!offset) void writeCache(`sessions-${filter}`, fresh);
        })
        .catch(() => undefined) // the connection banner explains outages; keep what we have
        .finally(() => {
          if (id === request.current) setLoading(false);
        });
    },
    [filter, get],
  );

  // Last known first page for this filter until Hermes answers.
  useEffect(() => {
    if (!enabled) return;
    void readCache<SessionListRow[]>(`sessions-${filter}`).then((cached) => {
      if (cached?.length) setRows((current) => (current.length ? current : cached));
    });
  }, [enabled, filter]);

  const refresh = useCallback(() => {
    setLoading(true);
    return fetchPage(0);
  }, [fetchPage]);

  const exhausted = total !== null && rows.length >= total;
  const loadMore = useCallback(() => {
    if (loading || exhausted) return;
    setLoading(true);
    void fetchPage(rows.length);
  }, [exhausted, fetchPage, loading, rows.length]);

  // (Re)load whenever the tab is shown, the filter changes, or the socket reconnects.
  const ready = enabled && connection === "open";
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const key = ready ? filter : null;
  if (key !== loadedFor) {
    setLoadedFor(key);
    if (key) {
      setLoading(true);
      setRows([]);
      setTotal(null);
    }
  }
  useEffect(() => {
    if (key) void fetchPage(0);
  }, [key, fetchPage]);

  return { rows, loading, exhausted, total, refresh, loadMore };
}
