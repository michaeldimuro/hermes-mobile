/**
 * Who speaks and when a turn is over — ports of `group-rounds.ts` (mention parse, responders,
 * rotation, unanswered hand-offs) and `group-turns.ts` (pass text, reply pick, busy state).
 */
import { botFriendlyNames, botHandle, groupMemberKey, mentionNameForms, type EngineAuthor, type EngineEntry, type EngineMember } from "./roundPrompt";

export const GROUP_CHAT_MAX_ROUNDS = 3;
export const GROUP_CHAT_MAX_MESSAGES = 10;
export const GROUP_CHAT_MAX_CONTINUATIONS = 2;
export const GROUP_TURN_TIMEOUT_MS = 180_000;
export const GROUP_TURN_HARD_CAP_MS = 180 * 60_000;
export const GROUP_TURN_POLL_MS = 5_000;
export const GROUP_DUPLICATE_APPEND_WINDOW_MS = 10 * 60_000;

export const threadOf = (entry: { thread?: string }) => entry?.thread || "legacy";

/** `parseGroupChatMentions`: @name / @title / @everyone / @all; `@user` is ignored. */
export function parseGroupChatMentions(text: unknown, members: EngineMember[]) {
  const source = String(text || "");
  const mentioned = new Set<string>();
  let everyone = false;
  const handles = new Map<string, string>();
  for (const member of members) {
    const title = String(member.title || "").trim();
    const handle = String(botHandle(member.name, member) || "").trim();
    const forms = new Set([
      member.name.toLowerCase(),
      member.name.toLowerCase().replace(/[\s_-]+/g, ""),
      ...(handle ? [handle.toLowerCase(), handle.toLowerCase().replace(/[\s_-]+/g, "")] : []),
      ...(title ? [title.toLowerCase(), title.toLowerCase().replace(/[\s_-]+/g, ""), title.split(/\s+/)[0].toLowerCase()] : []),
    ]);
    for (const friendly of botFriendlyNames(member)) for (const form of mentionNameForms(friendly)) forms.add(form);
    if (!member.remoteSource) forms.add(`${member.name.toLowerCase()}-local`);
    for (const form of forms) if (form) handles.set(form, groupMemberKey(member));
    for (const raw of [member.name, handle, title, ...botFriendlyNames(member)])
      for (const form of mentionNameForms(raw)) if (form && !handles.has(form)) handles.set(form, groupMemberKey(member));
  }
  for (const member of members)
    for (const name of member.previous_names ?? [])
      for (const form of mentionNameForms(name)) if (form && !handles.has(form)) handles.set(form, groupMemberKey(member));
  for (const match of source.matchAll(/@([a-z0-9][a-z0-9._-]*)/gi)) {
    const handle = match[1].toLowerCase();
    if (handle === "everyone" || handle === "all") {
      everyone = true;
      continue;
    }
    if (handle === "user") continue;
    const resolved = handles.get(handle) || handles.get(handle.replace(/[._-]+/g, ""));
    if (resolved) mentioned.add(resolved);
  }
  return { everyone, mentioned };
}

/** `resolveGroupResponders`: mentioned members since the last user entry, else everyone. */
export function resolveGroupResponders(log: EngineEntry[], members: EngineMember[]): EngineMember[] {
  let sinceLastUser: EngineEntry[] = [];
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i].from.kind === "user") {
      sinceLastUser = log.slice(i);
      break;
    }
  }
  const mentioned = new Set<string>();
  let everyone = false;
  for (const entry of sinceLastUser) {
    const parsed = parseGroupChatMentions(entry.text, members);
    if (parsed.everyone) everyone = true;
    for (const key of parsed.mentioned) mentioned.add(key);
  }
  if (everyone || mentioned.size === 0) return members;
  return members.filter((member) => mentioned.has(groupMemberKey(member)));
}

/** `rotateGroupSpeakers`: a different member leads each round. */
export function rotateGroupSpeakers<T>(members: T[], round: number): T[] {
  if (members.length < 2) return members;
  const shift = round % members.length;
  return [...members.slice(shift), ...members.slice(0, shift)];
}

/** `unaddressedGroupMentions`: members a bot @-cited in this thread who have not posted since. */
export function unaddressedGroupMentions(threadLog: EngineEntry[], members: EngineMember[]): string[] {
  const keyOf = (name?: string) => {
    const m = members.find((mm) => mm.name === name);
    return m ? groupMemberKey(m) : null;
  };
  const citedAt = new Map<string, number>();
  threadLog.forEach((entry, index) => {
    if (entry.from.kind !== "member") return;
    const citing = keyOf(entry.from.name);
    for (const key of parseGroupChatMentions(entry.text || "", members).mentioned) if (citing && citing !== key) citedAt.set(key, index);
  });
  const lastPostAt = new Map<string, number>();
  threadLog.forEach((entry, index) => {
    if (entry.from.kind !== "member") return;
    const speaker = keyOf(entry.from.name);
    if (speaker) lastPostAt.set(speaker, index);
  });
  return [...citedAt.keys()].filter((key) => {
    const answered = lastPostAt.get(key);
    return answered === undefined || answered <= (citedAt.get(key) ?? -1);
  });
}

/** `isGroupPassText`: "(pass)", "pass", "Pass." or empty. */
export function isGroupPassText(text: unknown) {
  const trimmed = String(text || "").trim();
  return !trimmed || /^\(?\s*pass\s*\)?\.?$/i.test(trimmed);
}

export type TranscriptMessage = { role?: string; content?: unknown; text?: string; timestamp?: number };

export function transcriptText(msg: TranscriptMessage): string {
  if (typeof msg?.content === "string") return msg.content;
  if (Array.isArray(msg?.content))
    return msg.content.map((p: unknown) => (typeof p === "string" ? p : ((p as { text?: string })?.text ?? ""))).join("");
  return msg?.text || "";
}

/** `pickGroupTurnReply`: newest substantive assistant row after `before`, else the newest pass. */
export function pickGroupTurnReply(messages: TranscriptMessage[], before: number): string | null {
  let passText: string | null = null;
  for (let i = messages.length - 1; i >= before; i--) {
    const msg = messages[i];
    if (msg?.role !== "assistant") continue;
    const replyText = String(transcriptText(msg)).trim();
    if (isGroupPassText(replyText)) {
      if (passText === null) passText = replyText;
      continue;
    }
    return replyText;
  }
  return passText;
}

export type SessionSnapshot = {
  inflight?: boolean | { error?: string; status?: string } | null;
  message_count?: number;
  messages?: TranscriptMessage[];
  open_requests?: { id: string; method: string; params?: Record<string, unknown> }[];
  pending_approval?: { request_id?: string } | null;
  running?: boolean;
  session_id?: string;
  session_key?: string;
  stored_session_id?: string;
};

/** `retainedGroupTurnError`. */
export function retainedGroupTurnError(state: SessionSnapshot | null | undefined): string | null {
  const inflight = state?.inflight;
  if (inflight && typeof inflight === "object" && inflight.status === "error") return String(inflight.error || "turn failed");
  return null;
}

/** `groupSessionBusy`: running, or in flight without a retained error. */
export function groupSessionBusy(state: SessionSnapshot | null | undefined): boolean {
  if (state?.running) return true;
  return Boolean(state?.inflight) && retainedGroupTurnError(state) === null;
}

/** A blocking clarify/approval inside the session (the member is waiting on the user). */
export function sessionAwaitingUser(state: SessionSnapshot | null | undefined): boolean {
  const open = Array.isArray(state?.open_requests) && state.open_requests.some((r) => r && typeof r.id === "string");
  return open || Boolean(state?.pending_approval && typeof state.pending_approval === "object" && state.pending_approval.request_id);
}

/** Mobile's busy check before prompting a member (spec §4 d/a). */
export const sessionUnavailable = (state: SessionSnapshot | null | undefined) => groupSessionBusy(state) || sessionAwaitingUser(state);

/** Unix-seconds timestamp → ms of the member's last room prompt (`[Group chat: "` user row), else null. */
export function lastRoomPromptAt(messages: TranscriptMessage[] | undefined): number | null {
  for (let i = (messages?.length ?? 0) - 1; i >= 0; i--) {
    const msg = messages![i];
    if (msg?.role === "user" && transcriptText(msg).startsWith('[Group chat: "') && typeof msg.timestamp === "number")
      return Math.round(msg.timestamp * 1000);
  }
  return null;
}

/** `authoredByMember`: the watermark steps over a member's own entries only when the source matches. */
export function authoredByMember(entry: EngineEntry, member: EngineMember): boolean {
  const source = member.remoteSource ? member.connectionLabel || member.connectionId : undefined;
  return entry?.from?.kind === "member" && entry.from.name === member.name && String(entry.from.source || "") === String(source || "");
}

/** `groupMemberAuthor`: the `from` stamp of a member reply. */
export function groupMemberAuthor(member: EngineMember): { kind: "member"; name: string; source?: string } {
  const source = member.connectionLabel || member.connectionId;
  return { kind: "member", name: member.name, ...(source ? { source } : {}) };
}

const EMPTY_SENTINEL = "(empty)";
const EMPTY_FRIENDLY =
  "⚠️ The model returned no response after processing tool results. This can happen with some models — try again or rephrase your question.";
/** `normalizeGroupChatText`. */
export function normalizeGroupChatText(text: string): string {
  const trimmed = String(text || "").trim();
  return trimmed === EMPTY_SENTINEL ? EMPTY_FRIENDLY : trimmed;
}

/** `isDuplicateGroupAppend`: a member reply identical to the room's last entry within 10 minutes. */
export function isDuplicateGroupAppend(last: EngineEntry | undefined, from: EngineAuthor, text: string, thread: string, now = Date.now()) {
  if (!last || from.kind !== "member" || last.from?.kind !== "member") return false;
  if (String(last.from?.name || "") !== String(from.name || "")) return false;
  if (String(last.from?.source || "") !== String(from.source || "")) return false;
  if (threadOf(last) !== (thread || "legacy")) return false;
  if (now - (last.at || 0) > GROUP_DUPLICATE_APPEND_WINDOW_MS) return false;
  return String(last.text || "") === String(text || "").trim();
}
