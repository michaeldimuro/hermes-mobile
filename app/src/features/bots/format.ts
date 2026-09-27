import { router, type Href } from "expo-router";
import type { ProfileRow } from "@/lib/gateway/types";

/** Mirrors hermes_constants.PROFILE_ID_RE — the on-disk profile id rule. */
export const BOT_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
/** hermes_cli/profiles.py `_RESERVED_NAMES` (collide with the install or system binaries). */
const RESERVED_NAMES = new Set(["hermes", "default", "test", "tmp", "root", "sudo"]);

/** Normalises free typing into a profile id: lowercase, spaces → hyphens, drops anything invalid. */
export function normalizeBotName(input: string) {
  return input
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 64);
}

/** Human error for a candidate id, or null when valid and free. */
export function botNameError(name: string, existing: string[]) {
  if (!name) return "Give your bot a name.";
  if (!/^[a-z0-9]/.test(name)) return "Start with a letter or number.";
  if (!BOT_NAME_RE.test(name)) return "Use lowercase letters, numbers, hyphens or underscores (max 64).";
  if (RESERVED_NAMES.has(name)) return `“${name}” is reserved. Pick another name.`;
  if (existing.includes(name)) return `A bot called “${name}” already exists.`;
  return null;
}

/** "growth-specialist" → "Growth Specialist"; honours display_name when the server has one. */
export function botTitle(profile: Pick<ProfileRow, "name" | "display_name"> | string) {
  const row = typeof profile === "string" ? { name: profile } : profile;
  const explicit = (row as ProfileRow).display_name?.trim();
  if (explicit) return explicit;
  return row.name
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function botRole(profile: Pick<ProfileRow, "description" | "is_default">) {
  const text = profile.description?.trim();
  if (text) return text;
  return profile.is_default ? "Your primary Hermes agent." : "No role described yet.";
}

export function modelLabel(provider?: string | null, model?: string | null) {
  if (!model) return "Default model";
  return provider ? `${provider} · ${model}` : model;
}

/** Default bot first, then alphabetical by name. */
export function sortBots(profiles: ProfileRow[]) {
  return [...profiles].sort((a, b) => {
    if (!!a.is_default !== !!b.is_default) return a.is_default ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/** Toolset labels arrive as "🔍 Web Search & Scraping": split the emoji glyph off for our own layout. */
const LEADING_EMOJI = (() => {
  try {
    return new RegExp("^(\\p{Extended_Pictographic}[\\uFE0F\\u200D\\p{Extended_Pictographic}]*)\\s*(.*)$", "u");
  } catch {
    return null; // engine without Unicode property escapes: show the label verbatim
  }
})();

export function splitLabel(label: string) {
  const match = LEADING_EMOJI ? label.match(LEADING_EMOJI) : null;
  return match ? { glyph: match[1], text: match[2] } : { glyph: "", text: label };
}

/** Navigate without depending on the (possibly stale) generated typed-routes file. */
export const go = {
  push: (path: string) => router.push(path as Href),
  replace: (path: string) => router.replace(path as Href),
  /** Open the bot's continuous conversation (its Hermes "Bot Chat"). */
  chatWith: (name: string) => router.push(`/bot/${encodeURIComponent(name)}` as Href),
};

export function sameSet(a: Set<string>, b: Set<string>) {
  if (a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
}
