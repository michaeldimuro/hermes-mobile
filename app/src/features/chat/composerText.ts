/** Pure text helpers for the composer's `/` (skills & commands) and `@` (bots) pickers. */

export type Trigger = { kind: "/" | "@"; query: string; start: number; end: number };

/**
 * The picker trigger the cursor is inside, if any.
 * `/` only counts as the very first token (Hermes slash commands); `@` counts at the start of any
 * word, so "ask @rese|" opens the bot picker filtered by "rese".
 */
export function detectTrigger(text: string, cursor: number = text.length): Trigger | null {
  const before = text.slice(0, cursor);
  const slash = /^\/([^\s]*)$/.exec(before);
  if (slash) return { kind: "/", query: slash[1], start: 0, end: cursor };
  const at = /(^|\s)@([\w.-]*)$/.exec(before);
  if (at) {
    const start = before.length - at[2].length - 1;
    return { kind: "@", query: at[2], start, end: cursor };
  }
  return null;
}

/** Replace the trigger span with `insert` plus a trailing space; returns the new text and cursor. */
export function applySuggestion(text: string, trigger: Trigger, insert: string) {
  const head = text.slice(0, trigger.start) + insert;
  const tail = text.slice(trigger.end).replace(/^\s*/, "");
  const next = `${head} ${tail}`;
  return { text: tail ? next : `${head} `, cursor: head.length + 1 };
}

/** `/name rest of line` → { name, arg }, or null for ordinary text. */
export function parseSlash(text: string): { name: string; arg: string } | null {
  const match = /^\/([^\s/]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  return match ? { name: match[1], arg: (match[2] ?? "").trim() } : null;
}

/** Bot handles mentioned in a message (`@researcher`), without duplicates, in order. */
export function mentionedHandles(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(/(^|\s)@([\w-]+)/g)) if (!out.includes(match[2])) out.push(match[2]);
  return out;
}

/** Case-insensitive ranking: prefix matches first, then word-start, then substring; others dropped. */
export function rankMatches<T>(items: T[], query: string, fields: (item: T) => string[]): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  const scored: { item: T; score: number }[] = [];
  for (const item of items) {
    const [primary = "", ...rest] = fields(item).map((field) => field.toLowerCase());
    let score = -1;
    if (primary.startsWith(q)) score = 0;
    else if (primary.split(/[-_\s]/).some((part) => part.startsWith(q))) score = 1;
    else if (primary.includes(q)) score = 2;
    else if (rest.some((field) => field.includes(q))) score = 3;
    if (score >= 0) scored.push({ item, score });
  }
  return scored.sort((a, b) => a.score - b.score).map((entry) => entry.item);
}

// ── Skill scaffolding ────────────────────────────────────────────────────────
// A `/skill` expands into a model-facing message embedding the whole skill body. Bubbles show the
// invocation instead. Mirrors hermes-agent apps/shared/src/skill-scaffold.ts (markers byte for byte).

const INVOCATION_PREFIX = "[IMPORTANT: The user has invoked the ";
const SINGLE_MARKER = "The full skill content is loaded below.]";
const SINGLE_INSTRUCTION = "The user has provided the following instruction alongside the skill invocation: ";
const RUNTIME_NOTE = "\n\n[Runtime note:";
const BUNDLE_MARKER = " skill bundle,";
const BUNDLE_INSTRUCTION = "\nUser instruction: ";
const BUNDLE_SKILL_BLOCK = "\n\n[Loaded as part of the ";
const NAME_RE = /^\[IMPORTANT: The user has invoked the "([^"]*)"/;

function between(text: string, marker: string, end: string, fromEnd = false) {
  const index = fromEnd ? text.lastIndexOf(marker) : text.indexOf(marker);
  if (index < 0) return "";
  const tail = text.slice(index + marker.length);
  const stop = tail.indexOf(end);
  return (stop >= 0 ? tail.slice(0, stop) : tail).trim();
}

/** `/work fix the leak` for a scaffolded skill turn, or null for ordinary text. */
export function skillInvocationText(text: string): string | null {
  if (!text.startsWith(INVOCATION_PREFIX)) return null;
  const name = (NAME_RE.exec(text)?.[1] ?? "").trim();
  if (!name) return null;
  const label = name.startsWith("/") ? name : `/${name}`;
  const instruction = text.includes(BUNDLE_MARKER)
    ? between(text, BUNDLE_INSTRUCTION, BUNDLE_SKILL_BLOCK)
    : text.includes(SINGLE_MARKER)
      ? between(text, SINGLE_INSTRUCTION, RUNTIME_NOTE, true)
      : "";
  return instruction ? `${label} ${instruction.replace(/\s+/g, " ")}` : label;
}
