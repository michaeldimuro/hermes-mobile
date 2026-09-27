/** Epoch seconds or milliseconds → milliseconds (Hermes mixes both). */
export const toMs = (value: number | null | undefined) => (!value ? 0 : value < 1e12 ? value * 1000 : value);

const DAY = 86_400_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Compact inbox timestamp: "now", "5m", "3h", "Yesterday", "Mon", "Sep 21", "Sep 21, 2025". */
export function shortTime(ms: number, now: number) {
  if (!ms) return "";
  const diff = now - ms;
  if (diff < 60_000) return "now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  const date = new Date(ms);
  const today = new Date(now);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (ms >= startOfToday) return `${Math.floor(diff / 3_600_000)}h`;
  if (ms >= startOfToday - DAY) return "Yesterday";
  if (ms >= startOfToday - 6 * DAY) return WEEKDAYS[date.getDay()];
  const label = `${MONTHS[date.getMonth()]} ${date.getDate()}`;
  return date.getFullYear() === today.getFullYear() ? label : `${label}, ${date.getFullYear()}`;
}

/** One-line preview: markdown noise removed, whitespace collapsed. */
export function previewText(text: string | null | undefined) {
  return (text ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#*_`>]+/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

const channel = (value: number) => {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance of a `#RGB` / `#RRGGBB` colour. */
export function luminance(hex: string) {
  const raw = hex.replace("#", "");
  const full = raw.length === 3 ? [...raw].map((c) => c + c).join("") : raw.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(full.slice(i, i + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** White text when it reaches 4.5:1 on `fill`, else black: keeps destructive buttons legible in both themes. */
export function readableInk(fill: string) {
  return contrastRatio(fill, "#FFFFFF") >= 4.5 ? "#FFFFFF" : "#000000";
}
