/**
 * Pure parsing/merging for the Hermes desktop "hermes-bots" group-chat mirror.
 *
 * The desktop mirrors every room into `ui_meta["hermes-bots-groups"]` of the default profile
 * (texts cut to 1200 chars, head-trimmed log). Each member also keeps a hidden session per room
 * thread (`Group: <roomId> · <thread>`) holding its untruncated replies and the room-update prompts
 * it was fed, which is where full texts and older history come from.
 */

export const GROUPS_META_KEY = "hermes-bots-groups";
const TRUNCATION_MARK = "… [truncated]";
const DELTA_HEADER = "New messages in the room since your last turn (oldest first):";
const DELTA_FOOTER = "\n\nRules for this room:";
const MATCH_WINDOW_MS = 10 * 60_000;
const EXACT_WINDOW_MS = 2 * 3600_000;
const USER_DEDUPE_WINDOW_MS = 15 * 60_000;
const GROUP_GAP_MS = 5 * 60_000;

export type MirrorAuthor = { kind: "user" | "member"; name: string; source?: string };
/** `reconstructed`: rebuilt from member sessions rather than read from the mirror. */
export type MirrorEntry = { id: string; from: MirrorAuthor; text: string; at: number; thread?: string; truncated?: boolean; reconstructed?: boolean };
export type MirrorMember = { name: string; handle: string; connectionKind?: string; connectionLabel?: string; local: boolean };
/** `hasRoomId` is false for legacy rooms whose id is their display name. */
export type MirrorRoom = {
  key: string; roomId: string; hasRoomId: boolean; name: string; revision: number; omitted: number; members: MirrorMember[]; log: MirrorEntry[];
};
export type MirrorEnvelope = { version: number; updatedAt: number; rooms: MirrorRoom[] };
export type RoomSummaryShape = {
  roomId: string;
  name: string;
  members: { name: string; handle: string }[];
  last?: { from: string; kind: "user" | "member"; text: string; at: number };
  updatedAt: number;
};
/** One normalised row of a member session transcript; `id` is the stored row id, or `i<index>` when the API omits it. */
export type SessionRow = { id: string; role: string; text: string; at: number };
/** A message recovered from a member session. */
export type Candidate = { from: MirrorAuthor; text: string; at: number; rowId?: string };

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown) => (typeof value === "string" ? value : "");
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const stripMark = (text: string) => {
  const trimmed = text.trimEnd();
  return trimmed.endsWith(TRUNCATION_MARK) ? trimmed.slice(0, -TRUNCATION_MARK.length).trimEnd() : trimmed;
};
/** Whitespace-insensitive comparison key; drops the desktop's truncation mark. */
export const normalizeText = (text: string) => stripMark(text).replace(/\s+/g, " ").trim();
/** Mirror text shown when no full version could be found. */
export const truncatedFallback = (text: string) => `${stripMark(text)}…(truncated)`;

/** Finds the groups envelope and its revision on the default profile row of `profiles.list`. */
export function readGroupsMeta(profiles: unknown): { envelope: unknown; revision: number | null } {
  const rows = Array.isArray(profiles) ? profiles.filter(isObj) : [];
  const row = rows.find((p) => p.name === "default") ?? rows.find((p) => p.is_default === true);
  if (!row) return { envelope: null, revision: null };
  const meta = isObj(row.ui_meta) ? row.ui_meta : {};
  const revisions = isObj(row.ui_meta_revisions) ? row.ui_meta_revisions : {};
  const revision = revisions[GROUPS_META_KEY];
  return { envelope: meta[GROUPS_META_KEY] ?? null, revision: typeof revision === "number" ? revision : null };
}

function parseMember(raw: unknown): MirrorMember | null {
  if (!isObj(raw)) return null;
  const name = str(raw.name).trim();
  if (!name) return null;
  const connectionKind = str(raw.connectionKind) || undefined;
  const local = !raw.remoteSource && (!connectionKind || connectionKind === "local") && !name.includes("::");
  return { name, handle: str(raw.handle).trim() || name, connectionKind, connectionLabel: str(raw.connectionLabel) || undefined, local };
}

function parseEntry(raw: unknown, index: number, roomId: string): MirrorEntry | null {
  if (!isObj(raw) || typeof raw.text !== "string") return null;
  const from = isObj(raw.from) ? raw.from : {};
  const kind = from.kind === "member" ? "member" : "user";
  const at = num(raw.at);
  const entry: MirrorEntry = {
    id: str(raw.id) || `${roomId}:${index}:${at}`,
    from: { kind, name: str(from.name) || (kind === "member" ? "Bot" : "You"), ...(str(from.source) ? { source: str(from.source) } : {}) },
    text: raw.text,
    at,
  };
  if (str(raw.thread)) entry.thread = str(raw.thread);
  if (raw.truncated === true) entry.truncated = true;
  return entry;
}

const parseJson = (text: string): unknown => {
  try { return JSON.parse(text); } catch { return null; }
};

/** Parses the mirror envelope (versions 1–3); tombstoned rooms are dropped. */
export function parseGroupsEnvelope(raw: unknown): MirrorEnvelope {
  let env = raw;
  if (typeof env === "string") env = parseJson(env);
  if (!isObj(env) || !isObj(env.rooms)) return { version: 0, updatedAt: 0, rooms: [] };
  const deleted = isObj(env.deleted) ? env.deleted : {};
  const rooms: MirrorRoom[] = [];
  for (const [key, value] of Object.entries(env.rooms)) {
    if (!isObj(value)) continue;
    const keyName = key.startsWith("id:") ? "" : key.replace(/^name:/, "");
    const name = str(value.name).trim() || keyName || key.replace(/^id:/, "");
    const ownId = str(value.roomId).trim() || (key.startsWith("id:") ? key.slice(3) : "");
    const roomId = ownId || name;
    if (!roomId) continue;
    const tombstones = [key, `id:${roomId}`, ...(ownId ? [] : [name, `name:${name}`])];
    if (tombstones.some((k) => k in deleted)) continue;
    const members = (Array.isArray(value.members) ? value.members : []).map(parseMember).filter((m): m is MirrorMember => m !== null);
    const log = (Array.isArray(value.log) ? value.log : [])
      .map((e, i) => parseEntry(e, i, roomId))
      .filter((e): e is MirrorEntry => e !== null);
    rooms.push({ key, roomId, hasRoomId: Boolean(ownId), name, revision: num(value.revision), omitted: Math.max(0, num(value.omitted)), members, log });
  }
  return { version: num(env.version), updatedAt: num(env.updatedAt), rooms };
}

export function summarizeRoom(room: MirrorRoom, envelopeUpdatedAt: number): RoomSummaryShape {
  const last = room.log[room.log.length - 1];
  const members = room.members.map((m) => ({ name: m.name, handle: m.handle }));
  const summary: RoomSummaryShape = { roomId: room.roomId, name: room.name, members, updatedAt: last?.at || envelopeUpdatedAt };
  if (last) summary.last = { from: last.from.name, kind: last.from.kind, text: normalizeText(last.text), at: last.at };
  return summary;
}

/** Summaries sorted by last activity, newest first. */
export function summarizeEnvelope(env: MirrorEnvelope): RoomSummaryShape[] {
  return env.rooms.map((room) => summarizeRoom(room, env.updatedAt)).sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Titles of the hidden member sessions for a room: one per known thread, then the pre-thread title. */
export function memberSessionTitles(room: Pick<MirrorRoom, "roomId" | "log">) {
  const base = `Group: ${room.roomId}`;
  const threads = new Set(room.log.map((entry) => entry.thread).filter((t): t is string => Boolean(t)));
  return [...[...threads].map((thread) => `${base} · ${thread}`), base];
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content.map((part) => (typeof part === "string" ? part : isObj(part) ? str(part.text) : "")).join("");
  return "";
}

/** Normalises `/api/sessions/<id>/messages` rows (seconds → ms, hidden rows dropped). */
export function toSessionRows(messages: unknown): SessionRow[] {
  if (!Array.isArray(messages)) return [];
  const rows: SessionRow[] = [];
  for (const [index, raw] of messages.entries()) {
    // Hidden rows and compaction summaries (projected with `display_content`) are not room messages.
    if (!isObj(raw) || raw.display_kind === "hidden" || typeof raw.display_content === "string") continue;
    const text = contentText(raw.content);
    if (/^\[CONTEXT (COMPACTION|SUMMARY)/.test(text.trimStart())) continue;
    const ts = num(raw.timestamp);
    const rowId = typeof raw.id === "number" || typeof raw.id === "string" ? String(raw.id) : `i${index}`;
    rows.push({ id: rowId, role: str(raw.role), text, at: ts > 0 && ts < 1e12 ? Math.round(ts * 1000) : ts });
  }
  return rows;
}

const isReply = (text: string) => text.trim() !== "" && text.trim() !== "(pass)";

/** Every non-empty, non-"(pass)" assistant row (candidates for full-text resolution). */
export function assistantReplies(rows: SessionRow[], member: string): Candidate[] {
  return rows
    .filter((row) => row.role === "assistant" && isReply(row.text))
    .map((row) => ({ from: { kind: "member", name: member }, text: row.text.trim(), at: row.at, rowId: row.id }));
}

/** The reply each turn posted to the room: the last non-empty assistant row before the next prompt. */
export function turnReplies(rows: SessionRow[], member: string): Candidate[] {
  const out: Candidate[] = [];
  let pending: SessionRow | null = null;
  const flush = () => {
    if (pending && isReply(pending.text)) out.push({ from: { kind: "member", name: member }, text: pending.text.trim(), at: pending.at, rowId: pending.id });
    pending = null;
  };
  for (const row of rows) {
    if (row.role === "user") flush();
    else if (row.role === "assistant" && row.text.trim()) pending = row;
  }
  flush();
  return out;
}

const USER_LINE = /^ {2}([^\n:]{1,60}?) \(user\): /;
const SELF_LINE = /^ {2}([^\n:[]{1,80}?) \(you\)(?: \[[^\]\n]{1,130}\])?: /;
const SOURCED_LINE = /^ {2}([^\n:[]{1,80}?) \[[^\]\n]{1,130}\]: /;
const OMITTED_LINE = /^ {2}… \d+ earlier room messages? omitted since your last turn$/;

/** Display labels peers were shown as (`CEO (you)`, `CFO [This device]`), for unsourced lines. */
export function collectSpeakerLabels(prompts: string[]): string[] {
  const labels = new Set<string>();
  for (const prompt of prompts)
    for (const line of prompt.split("\n")) {
      const match = SELF_LINE.exec(line) ?? SOURCED_LINE.exec(line);
      if (match) labels.add(match[1].trim());
    }
  return [...labels];
}

export type DeltaLine = { kind: "user" | "member" | "note"; label: string; text: string };

/** Splits a room-update prompt's delta block into its lines (multi-line bodies kept together). */
export function parseDeltaLines(prompt: string, speakerLabels: string[] = []): DeltaLine[] {
  const start = prompt.indexOf(DELTA_HEADER);
  if (start < 0) return [];
  const bodyStart = start + DELTA_HEADER.length + 1;
  const end = prompt.lastIndexOf(DELTA_FOOTER);
  const body = prompt.slice(bodyStart, end > bodyStart ? end : undefined);
  const known = speakerLabels.filter(Boolean).sort((a, b) => b.length - a.length).map(escapeRe);
  const knownLine = known.length ? new RegExp(`^ {2}(${known.join("|")}): `) : null;
  const out: DeltaLine[] = [];
  for (const line of body.split("\n")) {
    const user = USER_LINE.exec(line);
    const member = user ? null : (SELF_LINE.exec(line) ?? SOURCED_LINE.exec(line) ?? knownLine?.exec(line) ?? null);
    if (user) out.push({ kind: "user", label: user[1].trim(), text: line.slice(user[0].length) });
    else if (member) out.push({ kind: "member", label: member[1].trim(), text: line.slice(member[0].length) });
    else if (OMITTED_LINE.test(line)) out.push({ kind: "note", label: "", text: line.trim() });
    else if (out.length) out[out.length - 1].text += `\n${line}`;
  }
  return out.map((entry) => ({ ...entry, text: entry.text.trimEnd() }));
}

/** User messages quoted in a member's room-update prompts, stamped with the prompt time. */
export function userLinesFromRows(rows: SessionRow[], speakerLabels: string[] = []): Candidate[] {
  const out: Candidate[] = [];
  for (const row of rows) {
    if (row.role !== "user") continue;
    parseDeltaLines(row.text, speakerLabels)
      .filter((line) => line.kind === "user" && line.text.trim())
      .forEach((line, i, all) => out.push({ from: { kind: "user", name: line.label }, text: line.text, at: row.at - (all.length - 1 - i) }));
  }
  return out;
}

/** All candidates a set of member transcripts yields (bot replies + quoted user lines). */
export function candidatesFromSessions(sessions: { member: string; rows: SessionRow[] }[], extraLabels: string[] = []) {
  const labels = [...extraLabels, ...collectSpeakerLabels(sessions.flatMap((s) => s.rows.filter((r) => r.role === "user").map((r) => r.text)))];
  return {
    replies: sessions.flatMap((s) => assistantReplies(s.rows, s.member)),
    turns: sessions.flatMap((s) => turnReplies(s.rows, s.member)),
    userLines: sessions.flatMap((s) => userLinesFromRows(s.rows, labels)),
  };
}

const sameAuthor = (a: MirrorAuthor, b: MirrorAuthor) => a.kind === b.kind && (a.kind === "user" || a.name === b.name);

/** Full texts for truncated mirror entries: same author, mirror text is a prefix, closest time wins. */
export function resolveTruncated(log: MirrorEntry[], candidates: Candidate[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of log) {
    if (!entry.truncated) continue;
    const prefix = normalizeText(entry.text);
    let best: Candidate | null = null;
    for (const c of candidates) {
      if (!sameAuthor(entry.from, c.from) || Math.abs(c.at - entry.at) > MATCH_WINDOW_MS) continue;
      const full = normalizeText(c.text);
      if (full.length <= prefix.length || !full.startsWith(prefix)) continue;
      if (!best || Math.abs(c.at - entry.at) < Math.abs(best.at - entry.at)) best = c;
    }
    if (best) out[entry.id] = best.text.trimEnd().endsWith(TRUNCATION_MARK) ? truncatedFallback(best.text) : best.text;
  }
  return out;
}

const overlaps = (a: string, b: string) => a === b || (a.length > 0 && b.length > 0 && (a.startsWith(b) || b.startsWith(a)));

/** Messages older than the mirror's first entry, rebuilt from member sessions and de-duplicated. */
export function reconstructEarlier(
  log: MirrorEntry[],
  replies: Candidate[],
  userLines: Candidate[],
  roomId = "room",
): MirrorEntry[] {
  const cutoff = log.length ? Math.min(...log.map((e) => e.at)) : Number.POSITIVE_INFINITY;
  const mirrorKeys = log.map((e) => ({ from: e.from, key: normalizeText(e.text) }));
  const inMirror = (c: Candidate, key: string) => mirrorKeys.some((m) => sameAuthor(m.from, c.from) && overlaps(m.key, key));
  const kept: (Candidate & { key: string })[] = [];
  const sorted = [...replies, ...userLines].filter((c) => c.at > 0 && c.at < cutoff).sort((a, b) => a.at - b.at);
  for (const c of sorted) {
    const key = normalizeText(c.text);
    if (!key || inMirror(c, key)) continue;
    const window = c.from.kind === "user" ? USER_DEDUPE_WINDOW_MS : Number.POSITIVE_INFINITY;
    if (kept.some((k) => sameAuthor(k.from, c.from) && k.key === key && c.at - k.at <= window)) continue;
    kept.push({ ...c, key });
  }
  return kept.map((c) => ({
    id: `earlier:${roomId}:${c.from.kind}:${c.from.name}:${c.at}`,
    from: c.from,
    text: c.text.trimEnd().endsWith(TRUNCATION_MARK) ? truncatedFallback(c.text) : c.text,
    at: c.at,
    reconstructed: true,
  }));
}

/**
 * Member replies that reached the room but are missing from the mirror, within the mirror's time
 * span. Each mirror entry absorbs at most one reply from the same member: identical normalised text
 * within EXACT_WINDOW_MS (the desktop can post a reply well after it was generated), or overlapping
 * text (the mirror may hold a truncated prefix) within MATCH_WINDOW_MS.
 */
export function mergeSessionReplies(log: MirrorEntry[], turns: Candidate[]): MirrorEntry[] {
  if (!log.length) return [];
  const first = Math.min(...log.map((e) => e.at));
  const last = Math.max(...log.map((e) => e.at));
  type Keyed = { name: string; key: string; at: number };
  const near = (m: Keyed, c: Keyed) =>
    m.name === c.name &&
    ((m.key === c.key && Math.abs(m.at - c.at) <= EXACT_WINDOW_MS) || (overlaps(m.key, c.key) && Math.abs(m.at - c.at) <= MATCH_WINDOW_MS));
  const mirror: Keyed[] = log.filter((e) => e.from.kind === "member").map((e) => ({ name: e.from.name, key: normalizeText(e.text), at: e.at }));
  const cands = turns
    .filter((c) => c.from.kind === "member" && isReply(c.text) && c.at >= first && c.at <= last)
    .sort((a, b) => a.at - b.at)
    .map((c) => ({ c, name: c.from.name, key: normalizeText(c.text), at: c.at }));
  // Pair each mirror entry with at most one reply, closest in time first.
  const pairs = mirror.flatMap((m, mi) => cands.flatMap((k, ci) => (near(m, k) ? [{ mi, ci, gap: Math.abs(m.at - k.at) }] : [])));
  const [usedM, usedC] = [new Set<number>(), new Set<number>()];
  for (const p of pairs.sort((a, b) => a.gap - b.gap)) {
    if (usedM.has(p.mi) || usedC.has(p.ci)) continue;
    usedM.add(p.mi);
    usedC.add(p.ci);
  }
  const [out, added]: [MirrorEntry[], Keyed[]] = [[], []];
  for (const [ci, k] of cands.entries()) {
    const { c } = k;
    if (usedC.has(ci) || added.some((a) => near(a, k))) continue;
    added.push(k);
    out.push({
      id: `session:${c.from.name}:${c.rowId ?? c.at}`,
      from: { kind: "member", name: c.from.name },
      text: c.text.trimEnd().endsWith(TRUNCATION_MARK) ? truncatedFallback(c.text) : c.text,
      at: c.at,
      // Same thread as the mirror entry it follows, so thread dividers stay right.
      ...(threadAt(log, c.at) ? { thread: threadAt(log, c.at) } : {}),
      reconstructed: true,
    });
  }
  return out;
}

const threadAt = (log: MirrorEntry[], at: number) => log.filter((e) => e.at <= at && e.thread).pop()?.thread;

/** Interleaves entry lists by time (stable, so mirror order wins ties). */
export function mergeByTime(...lists: MirrorEntry[][]): MirrorEntry[] {
  return lists.flat().map((e, i) => ({ e, i })).sort((a, b) => a.e.at - b.e.at || a.i - b.i).map(({ e }) => e);
}

const DAY_MS = 86_400_000;
const startOfDay = (ms: number) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** "Today", "Yesterday", weekday within a week, else a date. */
export function dayLabel(at: number, now: number) {
  const diff = Math.round((startOfDay(now) - startOfDay(at)) / DAY_MS);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  const d = new Date(at);
  if (diff < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

export type TimelineRow =
  | { type: "day"; key: string; label: string }
  | { type: "thread"; key: string }
  /** `first`/`last` of a run from one sender: show avatar+name / the time. */
  | { type: "message"; key: string; entry: MirrorEntry; text: string; status: "full" | "loading" | "missing"; first: boolean; last: boolean };

/** Oldest→newest display rows: day separators, "new thread" dividers and sender grouping. */
export function buildRoomTimeline(
  entries: MirrorEntry[],
  opts: { now: number; fullTexts?: Record<string, string | null>; resolving?: boolean },
): TimelineRow[] {
  const rows: TimelineRow[] = [];
  let prev: MirrorEntry | null = null;
  let lastMessage: Extract<TimelineRow, { type: "message" }> | null = null;
  for (const entry of entries) {
    const newDay = !prev || startOfDay(prev.at) !== startOfDay(entry.at);
    const newThread = Boolean(prev?.thread && entry.thread && prev.thread !== entry.thread);
    if (newDay) rows.push({ type: "day", key: `day:${startOfDay(entry.at)}:${entry.id}`, label: dayLabel(entry.at, opts.now) });
    if (newThread) rows.push({ type: "thread", key: `thread:${entry.id}` });
    const grouped = Boolean(prev && !newDay && !newThread && sameAuthor(prev.from, entry.from) && entry.at - prev.at <= GROUP_GAP_MS);
    if (lastMessage && !grouped) lastMessage.last = true;
    const full = opts.fullTexts?.[entry.id];
    const status = !entry.truncated || typeof full === "string" ? "full" : full === undefined && opts.resolving ? "loading" : "missing";
    const text = typeof full === "string" && entry.truncated ? full : status === "loading" ? entry.text.replace(TRUNCATION_MARK, "…") : status === "missing" ? truncatedFallback(entry.text) : entry.text;
    lastMessage = { type: "message", key: entry.id, entry, text, status, first: !grouped, last: false };
    rows.push(lastMessage);
    prev = entry;
  }
  if (lastMessage) lastMessage.last = true;
  return rows;
}
