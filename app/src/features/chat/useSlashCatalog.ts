import { useEffect, useState } from "react";
import { useGateway } from "@/lib/store/GatewayProvider";

export type SlashEntry = { kind: "skill" | "command"; name: string; description: string; category?: string };
type Catalog = { skills: SlashEntry[]; commands: SlashEntry[] };

const TTL_MS = 5 * 60_000;
/** Per-bot cache shared by every composer; skills rarely change mid-conversation. */
const cache = new Map<string, { at: number; catalog: Catalog }>();

type SkillRow = { name: string; description?: string | null; category?: string | null; enabled?: boolean };
type CompletionItem = { text: string; meta?: string; kind?: string | null };

/** Strip the "⚡ " marker Hermes prefixes skill descriptions with in completions. */
const clean = (text?: string | null) => (text ?? "").replace(/^\s*⚡\s*/, "").trim();

/**
 * What `/` can run for `profile`: every enabled skill (from the bot's skill list, with descriptions
 * and categories) plus Hermes slash commands. Loads lazily the first time `active` is true.
 */
export function useSlashCatalog(profile: string, active: boolean) {
  const { get, call } = useGateway();
  const [catalog, setCatalog] = useState<Catalog | null>(() => cache.get(profile)?.catalog ?? null);
  const [shownFor, setShownFor] = useState(profile);
  if (shownFor !== profile) {
    setShownFor(profile);
    setCatalog(cache.get(profile)?.catalog ?? null);
  }

  useEffect(() => {
    if (!active) return;
    const cached = cache.get(profile);
    if (cached && Date.now() - cached.at < TTL_MS) return;
    let live = true;
    Promise.all([
      get<SkillRow[]>(`/api/skills?profile=${encodeURIComponent(profile)}`).catch(() => [] as SkillRow[]),
      call<{ items?: CompletionItem[] }>("complete.slash", { text: "/" }).catch(() => ({ items: [] as CompletionItem[] })),
    ]).then(([skills, completions]) => {
      const seen = new Set<string>();
      const skillEntries: SlashEntry[] = (Array.isArray(skills) ? skills : [])
        .filter((skill) => skill.enabled !== false && skill.name && !seen.has(skill.name) && seen.add(skill.name))
        .map((skill) => ({ kind: "skill" as const, name: skill.name, description: clean(skill.description), category: skill.category ?? undefined }))
        .sort((a, b) => a.name.localeCompare(b.name));
      const commandEntries: SlashEntry[] = (completions.items ?? [])
        .filter((item) => item.kind !== "skill" && item.text && !seen.has(item.text))
        .map((item) => ({ kind: "command" as const, name: item.text.replace(/^\//, ""), description: clean(item.meta) }));
      const next = { skills: skillEntries, commands: commandEntries };
      cache.set(profile, { at: Date.now(), catalog: next });
      if (live) setCatalog(next);
    });
    return () => {
      live = false;
    };
  }, [active, call, get, profile]);

  return { catalog, loading: active && !catalog };
}
