/**
 * Pure helpers that turn a hosted room's append-only event log into chat UI state.
 * Mirrors the server's Discussion policy (`gateway/hosted_room_discussion.py`) closely enough to
 * predict which bot is working: the log only records terminal turn events, never "started".
 */
import type { GroupEvent, GroupMember, GroupMemberInput, GroupRoom } from "./types";

// ── members ──────────────────────────────────────────────────────────────────

export type MemberView = { id: string; profile: string; handle: string; name: string };

const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export function memberView(member: GroupMember, index = 0): MemberView {
  const profile = str(member.profile) || str(member.member_id) || `bot-${index + 1}`;
  const id = str(member.member_id) || profile;
  const handle = str(member.handle) || profile;
  return { id, profile, handle, name: str(member.display_name) || titleCase(profile) };
}

export function roomMembers(room: Pick<GroupRoom, "members"> | null | undefined): MemberView[] {
  return (room?.members ?? []).map(memberView);
}

/** "growth-specialist" → "Growth Specialist". */
export function titleCase(name: string) {
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** The exact roster row shape `groups.create` validates (member/profile/handle must match a local profile). */
export function memberInput(profile: string, displayName?: string): GroupMemberInput {
  return {
    member_id: profile,
    profile,
    handle: profile,
    display_name: (displayName ?? "").trim() || titleCase(profile),
    target: { kind: "local", profile },
  };
}

// ── log merging ──────────────────────────────────────────────────────────────

/** Merge a `groups.log` delta into the known log: dedupe by `seq`, keep ascending order. */
export function mergeEvents(existing: GroupEvent[], incoming: GroupEvent[]): GroupEvent[] {
  if (!incoming.length) return existing;
  const lastSeq = existing.length ? existing[existing.length - 1].seq : 0;
  // Fast path: a strictly newer, ordered page just appends.
  if (incoming.every((event, i) => event.seq > (i ? incoming[i - 1].seq : lastSeq))) {
    return existing.concat(incoming);
  }
  const bySeq = new Map<number, GroupEvent>();
  for (const event of existing) bySeq.set(event.seq, event);
  for (const event of incoming) bySeq.set(event.seq, event);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

export const latestSeq = (events: GroupEvent[]) => (events.length ? events[events.length - 1].seq : 0);

// ── mentions ─────────────────────────────────────────────────────────────────

const MENTION_RE = /@([A-Za-z0-9][A-Za-z0-9._:-]*)/g;

/** Handles mentioned in `text` that belong to the roster (lower-cased), plus whether @all/@everyone was used. */
export function mentionedHandles(text: string, members: MemberView[]) {
  const known = new Set(members.map((m) => m.handle.toLowerCase()));
  const handles = new Set<string>();
  let everyone = false;
  for (const match of text.matchAll(MENTION_RE)) {
    const handle = match[1].toLowerCase();
    if (handle === "all" || handle === "everyone") everyone = true;
    else if (known.has(handle)) handles.add(handle);
  }
  return { handles, everyone };
}

/** Server rule (`resolve_mentions`): no mention (or @all) addresses everyone, in roster order. */
export function resolveMentions(text: string, members: MemberView[], defaultAll = true): MemberView[] {
  const { handles, everyone } = mentionedHandles(text, members);
  if (everyone || (defaultAll && handles.size === 0)) return members;
  return members.filter((m) => handles.has(m.handle.toLowerCase()));
}

/** Add or remove a leading `@handle` in the draft (mention chips). */
export function toggleMention(draft: string, handle: string) {
  const re = new RegExp(`(^|\\s)@${handle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9._:-])\\s?`, "i");
  if (re.test(draft)) return draft.replace(re, "$1").replace(/^\s+/, "");
  return `@${handle} ${draft.replace(/^\s+/, "")}`;
}

// ── timeline ─────────────────────────────────────────────────────────────────

export type TimelineItem =
  | { type: "user"; key: string; seq: number; text: string; createdAt: number; pending?: boolean }
  | {
      type: "member";
      key: string;
      seq: number;
      member: MemberView;
      text: string;
      createdAt: number;
      /** First message of a run from the same bot: show avatar + name. */
      showHeader: boolean;
    }
  | { type: "notice"; key: string; seq: number; text: string; tone: "info" | "warn" | "error"; createdAt: number };

function memberFor(event: GroupEvent, members: MemberView[]): MemberView {
  const id = str(event.payload.member_id) || str(event.actor?.id);
  const found = members.find((m) => m.id === id) ?? members.find((m) => m.profile === str(event.actor?.profile));
  if (found) return found;
  const profile = str(event.actor?.profile) || id || "bot";
  return { id: id || profile, profile, handle: profile, name: str(event.actor?.display_name) || titleCase(profile) };
}

function notice(event: GroupEvent, text: string, tone: "info" | "warn" | "error" = "info"): TimelineItem {
  return { type: "notice", key: `e${event.seq}`, seq: event.seq, text, tone, createdAt: event.created_at };
}

/** One room event → at most one visible timeline item (session chrome and bookkeeping are dropped). */
export function eventToItem(event: GroupEvent, members: MemberView[]): TimelineItem | null {
  const p = event.payload ?? {};
  switch (event.kind) {
    case "message.user":
      return { type: "user", key: `e${event.seq}`, seq: event.seq, text: str(p.text), createdAt: event.created_at };
    case "message.member": {
      const text = str(p.text);
      if (!text) return null;
      return {
        type: "member",
        key: `e${event.seq}`,
        seq: event.seq,
        member: memberFor(event, members),
        text,
        createdAt: event.created_at,
        showHeader: true,
      };
    }
    case "turn.failed": {
      const error = str(p.error);
      return notice(event, `${memberFor(event, members).name} couldn't reply${error ? `: ${error}` : "."}`, "error");
    }
    case "turn.cancelled":
      // A newer message in the same thread silently supersedes older work.
      if (p.reason === "superseded_by_newer_user_event") return null;
      return notice(event, `${memberFor(event, members).name} stopped.`);
    case "turn.deferred":
      return notice(event, `${memberFor(event, members).name} is unavailable right now.`, "warn");
    case "member.unavailable":
      return notice(event, `${memberFor(event, members).name} is unavailable.`, "warn");
    case "room.stop_requested":
      return notice(event, "You stopped the bots.");
    case "room.activity":
      return p.status === "bounded" ? notice(event, "The bots wrapped up. This discussion reached its limit.") : null;
    case "room.created":
      return notice(event, "Room created");
    case "room.renamed":
      return str(p.name) ? notice(event, `Renamed to “${str(p.name)}”`) : null;
    case "room.members_changed":
      return notice(event, "Members updated");
    case "room.disbanded":
      return notice(event, "This room was disbanded.", "warn");
    default:
      // turn.settled / turn.started / turn.reassigned / authority.* are bookkeeping.
      return null;
  }
}

/** Ascending log → ascending timeline, grouping consecutive replies from the same bot. */
export function buildTimeline(events: GroupEvent[], members: MemberView[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const event of events) {
    const item = eventToItem(event, members);
    if (!item) continue;
    const prev = items[items.length - 1];
    if (item.type === "member" && prev?.type === "member" && prev.member.id === item.member.id) {
      item.showHeader = false;
    }
    items.push(item);
  }
  return items;
}

// ── activity (who is working) ────────────────────────────────────────────────

const TERMINAL_KINDS = new Set(["turn.settled", "turn.failed", "turn.cancelled", "turn.deferred"]);
const MAX_ROUNDS = 3;
const MAX_DISCUSSION_MESSAGES = 10;

export type RoomActivity = {
  /** A user message is still being discussed. */
  pending: boolean;
  /** Best prediction of the bot whose turn is running (turns are sequential). */
  working: MemberView | null;
  discussionEventId: string | null;
};

const IDLE: RoomActivity = { pending: false, working: null, discussionEventId: null };

const rotate = <T,>(list: T[], shift: number) => {
  const n = list.length ? shift % list.length : 0;
  return [...list.slice(n), ...list.slice(0, n)];
};

/** Replays the server's Discussion policy (`plan_next_task`) over the visible log. */
export function deriveActivity(events: GroupEvent[], members: MemberView[]): RoomActivity {
  let stoppedThrough = 0;
  const completed = new Set<string>();
  const latestByThread = new Map<string, GroupEvent>();
  for (const event of events) {
    if (event.kind === "room.stop_requested" || event.kind === "room.disbanded") stoppedThrough = event.seq;
    else if (event.kind === "room.activity" && (event.payload.status === "settled" || event.payload.status === "bounded")) {
      completed.add(str(event.payload.discussion_event_id));
    } else if (event.kind === "message.user") latestByThread.set(str(event.payload.thread_id), event);
  }
  const discussion = [...latestByThread.values()]
    .sort((a, b) => a.seq - b.seq)
    .find((event) => event.seq > stoppedThrough && !completed.has(event.event_id));
  if (!discussion) return IDLE;

  const terminals = new Set<string>();
  const replies: GroupEvent[] = [];
  for (const event of events) {
    if (event.seq <= discussion.seq || event.payload.discussion_event_id !== discussion.event_id) continue;
    if (TERMINAL_KINDS.has(event.kind)) terminals.add(`${event.payload.round_index}:${event.payload.member_id}`);
    else if (event.kind === "message.member") replies.push(event);
  }
  const base = { pending: true, discussionEventId: discussion.event_id };
  if (replies.length >= MAX_DISCUSSION_MESSAGES) return { ...base, working: null };

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const responders = round === 0 ? resolveMentions(str(discussion.payload.text), members) : unaddressed(replies, members);
    const next = rotate(responders, round).find((m) => !terminals.has(`${round}:${m.id}`));
    if (next) return { ...base, working: next };
    if (!replies.some((r) => Number(r.payload.round_index) === round)) break;
  }
  // Every predicted turn has finished; the server is about to post its settle marker.
  return { ...base, working: null };
}

/** Peers a bot @-cited in this discussion that have not spoken since (`_unaddressed_member_mentions`). */
function unaddressed(replies: GroupEvent[], members: MemberView[]): MemberView[] {
  const citedAt = new Map<string, number>();
  const lastPostAt = new Map<string, number>();
  for (const reply of replies) {
    const speaker = str(reply.payload.member_id);
    lastPostAt.set(speaker, reply.seq);
    for (const m of resolveMentions(str(reply.payload.text), members, false)) {
      if (m.id !== speaker) citedAt.set(m.id, reply.seq);
    }
  }
  return members.filter((m) => citedAt.has(m.id) && (lastPostAt.get(m.id) ?? 0) <= (citedAt.get(m.id) ?? 0));
}

// ── list previews ────────────────────────────────────────────────────────────

export type RoomPreview = { text: string; author: string | null; at: number };

/** Latest human-readable line in a log tail, for the rooms list. */
export function roomPreview(events: GroupEvent[], members: MemberView[]): RoomPreview | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const item = eventToItem(events[i], members);
    if (!item) continue;
    const text = item.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const author = item.type === "user" ? "You" : item.type === "member" ? item.member.name : null;
    return { text, author, at: item.createdAt };
  }
  return null;
}

/** Compact relative time for list rows: "now", "5m", "3h", "Tue", "12 Mar". */
export function formatWhen(seconds: number, now = Date.now()) {
  if (!seconds) return "";
  const ms = seconds * 1000;
  const diff = Math.max(0, now - ms) / 1000;
  if (diff < 60) return "now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  const date = new Date(ms);
  if (diff < 6 * 86400) return date.toLocaleDateString(undefined, { weekday: "short" });
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** Client retry key for `groups.send`/`groups.rename` (server namespaces it; must match its identifier rule). */
export function clientEventId(prefix: string, now = Date.now(), rand = Math.random()) {
  return `${prefix}-${now.toString(36)}-${Math.floor(rand * 1e9).toString(36)}`;
}
