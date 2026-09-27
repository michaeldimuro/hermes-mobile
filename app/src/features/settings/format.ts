/**
 * Pure presentation helpers for Settings / Skills / Automations.
 * No React Native imports so they stay trivially unit-testable.
 */
import type { CronJob, CronOrigin, CronSchedule, Skill } from "./types";

export type Tone = "success" | "warn" | "danger" | "muted";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_ALIASES: Record<string, number> = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 9, 0 → "9:00 AM"; 0, 5 → "12:05 AM"; 13, 30 → "1:30 PM". */
export function formatClock(hour: number, minute: number): string {
  const suffix = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}

const isInt = (value: string) => /^\d+$/.test(value);
const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;

/** Recurring interval in minutes → "Every 30 minutes" / "Every 2 hours" / "Every 3 days". */
export function humanizeInterval(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "Custom interval";
  if (minutes % 10080 === 0) return minutes === 10080 ? "Every week" : `Every ${minutes / 10080} weeks`;
  if (minutes % 1440 === 0) return minutes === 1440 ? "Every day" : `Every ${minutes / 1440} days`;
  if (minutes % 60 === 0) return minutes === 60 ? "Every hour" : `Every ${minutes / 60} hours`;
  return minutes === 1 ? "Every minute" : `Every ${minutes} minutes`;
}

function parseDow(field: string): number[] | null {
  const out: number[] = [];
  for (const part of field.toUpperCase().split(",")) {
    const range = part.split("-");
    const toNum = (v: string) => (isInt(v) ? Number(v) % 7 : DAY_ALIASES[v]);
    if (range.length === 2) {
      const a = toNum(range[0]);
      // "5-7" means Fri..Sun, so keep 7 as the upper bound rather than folding it to 0.
      const end = range[1] === "7" ? 7 : toNum(range[1]);
      if (a === undefined || end === undefined || a > end) return null;
      for (let d = a; d <= end; d++) out.push(d % 7);
    } else {
      const d = toNum(part);
      if (d === undefined) return null;
      out.push(d);
    }
  }
  return [...new Set(out)].sort((x, y) => x - y);
}

function describeDays(days: number[]): string {
  const key = days.join(",");
  if (key === "1,2,3,4,5") return "Weekdays";
  if (key === "0,6") return "Weekends";
  if (days.length === 7) return "Every day";
  if (days.length === 1) return `Every ${DAY_NAMES[days[0]]}`;
  return days.map((d) => DAY_NAMES[d].slice(0, 3)).join(", ");
}

/** Common 5-field cron expressions → plain English. Returns null when the shape isn't recognised. */
export function humanizeCron(expr: string): string | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour, dom, month, dow] = parts;

  const stepMin = /^\*\/(\d+)$/.exec(min);
  if (stepMin && hour === "*" && dom === "*" && month === "*" && dow === "*") {
    const n = Number(stepMin[1]);
    return n === 1 ? "Every minute" : `Every ${n} minutes`;
  }
  if (min === "*" && hour === "*" && dom === "*" && month === "*" && dow === "*") return "Every minute";
  if (isInt(min) && hour === "*" && dom === "*" && month === "*" && dow === "*") {
    return Number(min) === 0 ? "Every hour" : `Every hour at :${min.padStart(2, "0")}`;
  }
  const stepHour = /^\*\/(\d+)$/.exec(hour);
  if (isInt(min) && stepHour && dom === "*" && month === "*" && dow === "*") {
    return `Every ${plural(Number(stepHour[1]), "hour")}`;
  }
  if (!isInt(min) || month !== "*") return null;
  const hours = hour.split(",");
  if (!hours.every(isInt)) return null;
  const times = hours.map((h) => formatClock(Number(h), Number(min))).join(", ");

  if (dom === "*" && dow === "*") return `Every day at ${times}`;
  if (dom === "*") {
    const days = parseDow(dow);
    if (!days || days.length === 0) return null;
    return `${describeDays(days)} at ${times}`;
  }
  if (isInt(dom) && dow === "*") return `Monthly on the ${ordinal(Number(dom))} at ${times}`;
  return null;
}

/** Short absolute date: "Sep 25, 10:00 AM" (local time). */
export function formatShortDate(date: Date): string {
  return `${MONTH_SHORT[date.getMonth()]} ${date.getDate()}, ${formatClock(date.getHours(), date.getMinutes())}`;
}

/** Any Hermes schedule (object or raw display string) → human-readable label. */
export function humanizeSchedule(schedule: CronSchedule | string | null | undefined, fallback?: string | null): string {
  if (!schedule) return fallback || "No schedule";
  if (typeof schedule === "string") return describeScheduleInput(schedule).label || schedule;
  if (schedule.kind === "interval" && typeof schedule.minutes === "number") return humanizeInterval(schedule.minutes);
  if (schedule.kind === "cron" && schedule.expr) return humanizeCron(schedule.expr) ?? schedule.expr;
  if (schedule.kind === "once" && schedule.run_at) {
    const at = new Date(schedule.run_at);
    return Number.isNaN(at.getTime()) ? "Once" : `Once · ${formatShortDate(at)}`;
  }
  return schedule.display || fallback || "Custom schedule";
}

/** "in 5m", "in 3h", "in 2d", "5m ago", "just now"; beyond a week falls back to a short date. */
export function relativeTime(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "Never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "Unknown";
  const diff = then - now;
  const abs = Math.abs(diff);
  if (abs < 45_000) return diff >= 0 ? "now" : "just now";
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  let span: string;
  if (abs < hour) span = `${Math.round(abs / minute)}m`;
  else if (abs < day) span = `${Math.round(abs / hour)}h`;
  else if (abs < 7 * day) span = `${Math.round(abs / day)}d`;
  else return formatShortDate(new Date(then));
  return diff >= 0 ? `in ${span}` : `${span} ago`;
}

const DURATION_RE = /^(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|week|weeks)$/i;

function durationMinutes(text: string): number | null {
  const match = DURATION_RE.exec(text.trim());
  if (!match) return null;
  const n = Number(match[1]);
  const unit = match[2][0].toLowerCase();
  return n * ({ m: 1, h: 60, d: 1440, w: 10080 } as Record<string, number>)[unit];
}

/**
 * Client-side preview of what Hermes' `cron.jobs.parse_schedule` will make of the text.
 * `ok` false means we can't recognise it — the server is still the final validator.
 */
export function describeScheduleInput(input: string): { ok: boolean; label: string | null } {
  const text = input.trim();
  if (!text) return { ok: false, label: null };
  const lower = text.toLowerCase();
  if (lower.startsWith("in ")) {
    const mins = durationMinutes(text.slice(3));
    return mins ? { ok: true, label: `Once, in ${text.slice(3).trim()}` } : { ok: false, label: null };
  }
  const rest = lower.startsWith("every ") ? text.slice(6) : text;
  const mins = durationMinutes(rest);
  if (mins) return { ok: true, label: humanizeInterval(mins) };
  const parts = text.split(/\s+/);
  if (parts.length >= 5 && parts.slice(0, 5).every((p) => /^[A-Za-z\d*\-,/]+$/.test(p))) {
    return { ok: true, label: humanizeCron(parts.slice(0, 5).join(" ")) ?? `Cron: ${text}` };
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const at = new Date(text);
    return Number.isNaN(at.getTime()) ? { ok: false, label: null } : { ok: true, label: `Once · ${formatShortDate(at)}` };
  }
  // Natural phrases ("every monday 9am", "weekdays at 9am") are parsed server-side.
  if (/\b(\d{1,2}(:\d{2})?\s*(am|pm)|weekdays?|weekends?|mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?|daily)\b/i.test(text)) {
    return { ok: true, label: text.charAt(0).toUpperCase() + text.slice(1) };
  }
  return { ok: false, label: null };
}

export interface SchedulePreset {
  id: string;
  label: string;
  schedule: string;
}

/** Presets are emitted in syntax `parse_schedule` accepts (cron / "every Nm"). */
export const SCHEDULE_PRESETS: SchedulePreset[] = [
  { id: "morning", label: "Every morning 8:00", schedule: "0 8 * * *" },
  { id: "weekdays", label: "Weekdays 9:00", schedule: "0 9 * * 1-5" },
  { id: "hourly", label: "Hourly", schedule: "0 * * * *" },
  { id: "30m", label: "Every 30 min", schedule: "every 30m" },
  { id: "evening", label: "Every evening 18:00", schedule: "0 18 * * *" },
  { id: "monday", label: "Mondays 9:00", schedule: "0 9 * * 1" },
];

export function jobIsPaused(job: Pick<CronJob, "enabled" | "state">): boolean {
  return job.enabled === false || job.state === "paused";
}

export function jobTitle(job: Pick<CronJob, "name" | "prompt" | "id">): string {
  const name = (job.name ?? "").trim();
  if (name) return name;
  const prompt = (job.prompt ?? "").trim().replace(/\s+/g, " ");
  if (prompt) return prompt.length > 60 ? `${prompt.slice(0, 59)}…` : prompt;
  return job.id;
}

/** Last-run outcome as a label + tone. Values come from cron/jobs.py mark_job_run. */
export function lastRunStatus(job: Pick<CronJob, "last_status" | "last_run_at" | "state">): { label: string; tone: Tone } {
  if (job.state === "running") return { label: "Running", tone: "success" };
  const status = job.last_status;
  if (!status) return { label: job.last_run_at ? "Ran" : "Never run", tone: "muted" };
  switch (status) {
    case "ok":
      return { label: "Succeeded", tone: "success" };
    case "error":
      return { label: "Failed", tone: "danger" };
    case "delivery_failed":
      return { label: "Delivery failed", tone: "warn" };
    case "blocked_config":
      return { label: "Blocked by config", tone: "warn" };
    default:
      return { label: titleCase(status), tone: "muted" };
  }
}

const PLATFORM_NAMES: Record<string, string> = {
  discord: "Discord",
  telegram: "Telegram",
  slack: "Slack",
  whatsapp: "WhatsApp",
  signal: "Signal",
  matrix: "Matrix",
  imessage: "iMessage",
  sms: "SMS",
  email: "Email",
  webhook: "Webhook",
  api_server: "API server",
  homeassistant: "Home Assistant",
  mattermost: "Mattermost",
};

export function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

export function platformName(id: string): string {
  return PLATFORM_NAMES[id.toLowerCase()] ?? titleCase(id);
}

/** Tone for a gateway_platforms[*].state value. */
export function platformTone(state: string | null | undefined): Tone {
  switch ((state ?? "").toLowerCase()) {
    case "connected":
    case "running":
      return "success";
    case "connecting":
    case "reconnecting":
    case "retrying":
    case "starting":
      return "warn";
    case "error":
    case "failed":
    case "fatal":
    case "disconnected":
      return "danger";
    default:
      return "muted";
  }
}

function describeOneTarget(target: string, origin?: CronOrigin | null): string {
  const t = target.trim();
  if (!t || t === "local") return "Saved on gateway";
  if (t === "origin") return origin?.platform ? `Reply in ${platformName(origin.platform)}` : "Reply where created";
  const [platform, ...rest] = t.split(":");
  const detail = rest.join(":");
  if (platform === "bot-chat") return detail ? `${detail} chat` : "Bot chat";
  if (!detail) return `${platformName(platform)} home channel`;
  return `${platformName(platform)} channel`;
}

/** `deliver` (comma separated targets) → short human label. */
export function deliveryLabel(deliver: string | null | undefined, origin?: CronOrigin | null): string {
  const targets = (deliver ?? "local").split(",").filter((t) => t.trim());
  if (targets.length === 0) return describeOneTarget("local");
  return targets.map((t) => describeOneTarget(t, origin)).join(" + ");
}

/** Icon hint for a delivery target (Ionicons names). */
export function deliveryIcon(deliver: string | null | undefined): "chatbubble-ellipses-outline" | "logo-discord" | "save-outline" | "send-outline" | "return-down-back-outline" {
  const first = (deliver ?? "local").split(",")[0].trim();
  if (!first || first === "local") return "save-outline";
  if (first === "origin") return "return-down-back-outline";
  if (first.startsWith("bot-chat")) return "chatbubble-ellipses-outline";
  if (first.startsWith("discord")) return "logo-discord";
  return "send-outline";
}

/** Categories sorted by skill count (desc), then name. Uncategorised skills are excluded. */
export function skillCategories(skills: Pick<Skill, "category">[]): string[] {
  const counts = new Map<string, number>();
  for (const s of skills) if (s.category) counts.set(s.category, (counts.get(s.category) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([c]) => c);
}

/** Case-insensitive name/description/category search plus optional category filter. */
export function filterSkills<T extends Pick<Skill, "name" | "description" | "category">>(
  skills: T[],
  query: string,
  category: string | null,
): T[] {
  const q = query.trim().toLowerCase();
  return skills.filter((s) => {
    if (category && s.category !== category) return false;
    if (!q) return true;
    return [s.name, s.description ?? "", s.category ?? ""].some((field) => field.toLowerCase().includes(q));
  });
}
