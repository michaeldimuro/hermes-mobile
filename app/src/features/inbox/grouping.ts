import type { SessionListRow } from "@/lib/gateway/types";
import type { SessionFilterId } from "@/features/chat/useAllSessions";
import { previewText } from "./format";
import type { Conversation } from "./useConversations";

export type BotConversation = Extract<Conversation, { kind: "bot" }>;

/** One entry in the Conversations list: a rich row, the section header, or a compact starter row. */
export type InboxItem =
  | { type: "conversation"; key: string; item: Conversation; separator: boolean }
  | { type: "header"; key: string; title: string }
  | { type: "starter"; key: string; item: BotConversation; separator: boolean };

export const START_HEADER = "Start a conversation";

/** Group chats always count as activity; a bot does once its Bot Chat has a message. */
export function hasActivity(item: Conversation) {
  return item.kind === "group" || Number(item.bot.canonical_session?.message_count ?? 0) > 0;
}

export function conversationMatches(item: Conversation, needle: string) {
  if (!needle) return true;
  const extra = item.kind === "group" ? item.members.join(" ") : `${item.bot.name} ${item.bot.description ?? ""}`;
  return `${item.title} ${item.preview} ${extra}`.toLowerCase().includes(needle);
}

/** Split into "has activity" (newest first) and "never chatted" bots (alphabetical), after search. */
export function groupConversations(list: Conversation[], query: string, pins: readonly string[] = []) {
  const needle = query.trim().toLowerCase();
  const active: Conversation[] = [];
  const starters: BotConversation[] = [];
  for (const item of list) {
    if (!conversationMatches(item, needle)) continue;
    // A pinned conversation stays up top even before its first message.
    if (hasActivity(item) || pins.includes(item.key)) active.push(item);
    else if (item.kind === "bot") starters.push(item);
  }
  const rank = (item: Conversation) => {
    const index = pins.indexOf(item.key);
    return index < 0 ? Number.POSITIVE_INFINITY : index;
  };
  active.sort((a, b) => rank(a) - rank(b) || b.at - a.at || a.title.localeCompare(b.title));
  starters.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }) || a.bot.name.localeCompare(b.bot.name));
  return { active, starters };
}

/** Flatten the two groups into list items; the header only appears when starters exist. */
export function inboxItems(list: Conversation[], query: string, pins: readonly string[] = []): InboxItem[] {
  const { active, starters } = groupConversations(list, query, pins);
  const items: InboxItem[] = active.map((item, index) => ({
    type: "conversation",
    key: item.key,
    item,
    separator: index < active.length - 1,
  }));
  if (starters.length) {
    items.push({ type: "header", key: "header:start", title: START_HEADER });
    starters.forEach((item, index) => items.push({ type: "starter", key: item.key, item, separator: index < starters.length - 1 }));
  }
  return items;
}

/** Stable identity for a session row across bots. */
export const sessionKey = (row: SessionListRow) => `${row.profile ?? "default"}:${row.id}`;

export function sessionMatches(row: SessionListRow, needle: string) {
  if (!needle) return true;
  return `${row.title ?? ""} ${previewText(row.preview)} ${row.profile ?? ""}`.toLowerCase().includes(needle);
}

/** Apply local edits (optimistic deletes, renames) and search to the fetched session rows. */
export function visibleSessions(
  rows: SessionListRow[],
  {
    hidden,
    titles,
    query,
    pinned = {},
  }: { hidden: ReadonlySet<string>; titles: Readonly<Record<string, string>>; query: string; pinned?: Readonly<Record<string, boolean>> },
) {
  const needle = query.trim().toLowerCase();
  const out: SessionListRow[] = [];
  for (const row of rows) {
    const key = sessionKey(row);
    if (hidden.has(key)) continue;
    let next = key in titles ? { ...row, title: titles[key] } : row;
    if (key in pinned) next = { ...next, pinned: pinned[key] };
    if (sessionMatches(next, needle)) out.push(next);
  }
  // Pinned sessions (Hermes's own flag, synced with desktop) lead; the list's recency order is kept otherwise.
  return [...out.filter((row) => row.pinned), ...out.filter((row) => !row.pinned)];
}

const EMPTY_SESSIONS: Record<SessionFilterId, string> = {
  all: "No sessions yet",
  chats: "No chats yet",
  channels: "No channel conversations yet",
  automations: "No automation runs yet",
  tasks: "No tasks yet",
};

export function sessionEmptyTitle(filter: SessionFilterId, searching: boolean) {
  return searching ? "No matches" : EMPTY_SESSIONS[filter];
}

export const DESKTOP_HELD = "Open in Hermes desktop, so it can't be deleted here";

/** Human copy for a failed delete; Hermes refuses sessions another client (desktop) holds open. */
export function deleteErrorText(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (/active session|in use|desktop|busy/i.test(message)) return DESKTOP_HELD;
  return message || "Could not delete the session";
}
