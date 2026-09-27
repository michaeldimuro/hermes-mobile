import { useCallback, useEffect, useRef, useState } from "react";
import { errorText, useGateway } from "@/lib/store/GatewayProvider";

export const PLUGIN = "/api/plugins/hermes-mobile";

export type Handoff = { id: string; task_id: string; reason: string; created_at: number };
type BrowserState = { handoffs: Handoff[]; browsers: { task_id: string }[] };

const FAST_MS = 2500;
const SLOW_MS = 12_000;
const notInstalled = (error: unknown) => /not found|\(404\)/i.test(errorText(error, ""));

/**
 * The bot's browser for this chat, from the hermes-mobile Hermes plugin: an open handoff (the bot is
 * waiting for you to sign in or similar) and whether a browser page is open at all. Polls quickly while
 * the bot works or waits on you, slowly otherwise, and stops for good when the plugin isn't installed.
 */
export function useChatBrowser({
  storedId,
  liveId,
  running,
  signInAsked,
}: {
  storedId?: string | null;
  liveId: () => string | null;
  running: boolean;
  /** The latest reply asks you to sign in: keep the bot's browser open while the card shows. */
  signInAsked: boolean;
}) {
  const { get, connection, showToast } = useGateway();
  const [state, setState] = useState<BrowserState>({ handoffs: [], browsers: [] });
  const [installed, setInstalled] = useState(true);
  const tick = useRef(0);

  const holding = useRef(false);
  const refresh = useCallback(async () => {
    const ids = [storedId, liveId()].filter((id): id is string => Boolean(id));
    if (!ids.length) return setState({ handoffs: [], browsers: [] });
    const query = ids.map((id) => `session=${encodeURIComponent(id)}`).join("&") + (holding.current ? "&hold=1" : "");
    try {
      setState(await get<BrowserState>(`${PLUGIN}/browser?${query}`));
    } catch (error) {
      if (notInstalled(error)) setInstalled(false);
    }
  }, [get, liveId, storedId]);

  const waiting = state.handoffs.length > 0 || (signInAsked && state.browsers.length > 0);
  useEffect(() => {
    holding.current = waiting;
  }, [waiting]);
  useEffect(() => {
    if (!installed || connection !== "open") return;
    const id = ++tick.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loop = async () => {
      await refresh();
      if (id === tick.current) timer = setTimeout(loop, running || waiting ? FAST_MS : SLOW_MS);
    };
    void loop();
    return () => {
      tick.current += 1;
      if (timer) clearTimeout(timer);
    };
  }, [connection, installed, refresh, running, waiting]);

  const finish = useCallback(
    async (handoff: Handoff, status: "done" | "cancelled") => {
      setState((prev) => ({ ...prev, handoffs: prev.handoffs.filter((h) => h.id !== handoff.id) }));
      try {
        await get(`${PLUGIN}/handoffs/${handoff.id}`, { method: "POST", body: JSON.stringify({ status }) });
      } catch (error) {
        showToast(errorText(error, "Couldn't tell the bot you're done"), "error");
      }
      void refresh();
    },
    [get, refresh, showToast],
  );

  const handoff = state.handoffs[state.handoffs.length - 1] ?? null;
  return {
    installed,
    handoff,
    /** The task whose browser to show: the handoff's, else any open browser for this chat. */
    task: handoff?.task_id ?? state.browsers[0]?.task_id ?? null,
    finish,
    refresh,
  };
}
