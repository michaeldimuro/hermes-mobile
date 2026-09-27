import type { ProfileRow } from "@/lib/gateway/types";
import { botModeTitle } from "./mentions";

/** Human title for a bot profile: display name, else a capitalised profile name. */
export function botTitle(profile: ProfileRow | undefined, fallback = "Hermes") {
  const display = profile?.display_name?.trim() || (profile ? botModeTitle(profile) : "");
  if (display) return display;
  const name = profile?.name?.trim();
  if (!name) return fallback;
  if (name === "default") return "Hermes";
  // "growth-specialist" → "Growth Specialist"
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function findBot(profiles: ProfileRow[], name: string) {
  return profiles.find((profile) => profile.name === name);
}

/** Bucket a unix timestamp (seconds) for the history sidebar. */
export function dayBucket(seconds: number | undefined, now = Date.now()) {
  if (!seconds) return "Older";
  const date = new Date(seconds * 1000);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((today.getTime() - new Date(date).setHours(0, 0, 0, 0)) / 86_400_000);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return "Previous 7 days";
  if (diffDays < 30) return "Previous 30 days";
  return "Older";
}
