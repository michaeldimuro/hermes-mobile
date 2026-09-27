import { useCallback, useEffect, useState } from "react";
import { errorText, useGateway } from "@/lib/store/GatewayProvider";

export type UsageTotals = {
  total_input: number;
  total_output: number;
  total_cache_read: number;
  total_reasoning: number;
  total_estimated_cost: number;
  total_actual_cost: number;
  total_sessions: number;
  total_api_calls: number;
};
export type UsageDay = { day: string; input_tokens: number; output_tokens: number; sessions: number; api_calls: number };
export type BotUsage = {
  bot: string;
  totals: UsageTotals;
  daily: UsageDay[];
  models: { model: string; input_tokens: number; output_tokens: number; sessions: number }[];
  tools: { tool: string; count: number }[];
};

type Raw = {
  totals?: Partial<UsageTotals>;
  daily?: UsageDay[];
  by_model?: BotUsage["models"];
  tools?: BotUsage["tools"];
};

const ZERO: UsageTotals = {
  total_input: 0,
  total_output: 0,
  total_cache_read: 0,
  total_reasoning: 0,
  total_estimated_cost: 0,
  total_actual_cost: 0,
  total_sessions: 0,
  total_api_calls: 0,
};

export const tokensOf = (t: UsageTotals) => t.total_input + t.total_output;
export const costOf = (t: UsageTotals) => t.total_actual_cost || t.total_estimated_cost;

/** "1.2M", "84k", "930". */
export function compact(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(n));
}

/** Per-bot token use over `days` from Hermes analytics (`/api/analytics/usage?profile=`), busiest first. */
export function useUsage(days: number) {
  const { get, profiles } = useGateway();
  const [rows, setRows] = useState<BotUsage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const names = profiles.map((p) => p.name).join(",");

  const load = useCallback(() => {
    const bots = names ? names.split(",") : [];
    return Promise.all(
      bots.map((bot) =>
        get<Raw>(`/api/analytics/usage?days=${days}&profile=${encodeURIComponent(bot)}`)
          .then((raw): BotUsage => ({
            bot,
            totals: { ...ZERO, ...(raw.totals ?? {}) },
            daily: raw.daily ?? [],
            models: raw.by_model ?? [],
            tools: raw.tools ?? [],
          }))
          .catch(() => null),
      ),
    )
      .then((results) => {
        const ok = results.filter((r): r is BotUsage => Boolean(r));
        if (!ok.length && bots.length) throw new Error("Hermes didn't return usage data.");
        setRows(ok.sort((a, b) => tokensOf(b.totals) - tokensOf(a.totals)));
        setError(null);
      })
      .catch((err) => setError(errorText(err, "Couldn't load usage")));
  }, [days, get, names]);

  useEffect(() => {
    void load();
  }, [load]);

  return { rows, error, reload: load };
}

/** Tokens per day for the last `days` days (oldest first), zero on days Hermes has no row for. */
export function daySeries(usage: Pick<BotUsage, "daily">, days: number, now = new Date()) {
  const byDay = new Map(usage.daily.map((d) => [d.day, d.input_tokens + d.output_tokens]));
  const out: number[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    out.push(byDay.get(key) ?? 0);
  }
  return out;
}
