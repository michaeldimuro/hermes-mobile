import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { errorText, useGateway } from "@/lib/store/GatewayProvider";
import { haptic } from "@/ui/primitives";
import type { Skill } from "./types";

/**
 * Skills are per profile (bot): GET /api/skills?profile=<bot>,
 * PUT /api/skills/toggle { name, enabled, profile }.
 */
export function useSkills(bot: string) {
  const { get, showToast } = useGateway();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentBot = useRef(bot);
  useLayoutEffect(() => {
    currentBot.current = bot;
  }, [bot]);

  /** Fetch this bot's skills; callers own flipping `loading`/`refreshing` on first. State is only
   *  set in promise callbacks (never synchronously), so effects can call this directly. */
  const fetchSkills = useCallback(
    (): Promise<void> =>
      get<Skill[]>(`/api/skills?profile=${encodeURIComponent(bot)}`)
        .then((rows) => {
          if (currentBot.current !== bot) return;
          setSkills([...(rows ?? [])].sort((a, b) => a.name.localeCompare(b.name)));
          setError(null);
        })
        .catch((err) => {
          if (currentBot.current === bot) setError(errorText(err, "Could not load skills."));
        })
        .finally(() => {
          setLoading(false);
          setRefreshing(false);
        }),
    [get, bot],
  );

  const load = useCallback(
    async (mode: "initial" | "refresh" = "initial") => {
      if (mode === "refresh") setRefreshing(true);
      else setLoading(true);
      await fetchSkills();
    },
    [fetchSkills],
  );

  // Switching bots clears the list and shows the spinner (during render); the effect only fetches.
  const [prevBot, setPrevBot] = useState(bot);
  if (bot !== prevBot) {
    setPrevBot(bot);
    setSkills([]);
    setLoading(true);
  }
  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  const toggle = useCallback(
    async (name: string, enabled: boolean) => {
      haptic.tap();
      const owner = bot;
      const apply = (value: boolean) =>
        setSkills((rows) => rows.map((s) => (s.name === name ? { ...s, enabled: value } : s)));
      apply(enabled);
      try {
        await get("/api/skills/toggle", {
          method: "PUT",
          body: JSON.stringify({ name, enabled, profile: owner }),
        });
      } catch (err) {
        if (currentBot.current === owner) apply(!enabled);
        haptic.warn();
        showToast(errorText(err, `Could not ${enabled ? "enable" : "disable"} ${name}.`), "error");
      }
    },
    [get, bot, showToast],
  );

  return { skills, loading, refreshing, error, refresh: () => load("refresh"), toggle };
}
