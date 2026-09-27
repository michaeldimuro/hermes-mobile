/**
 * Write-side codec for the desktop `hermes-bots-groups` mirror (ports of `group-chat.ts`):
 * v1/v2 → v3 normalisation, the gateway byte counter, text compaction, id minting and the
 * add-only mobile write with the desktop's size trim.
 */

export const GROUPS_KEY = "hermes-bots-groups";
export const SYNC_MAX_BYTES = 48_000;
export const SYNC_TEXT_CHARS = 1200;
export const TRUNCATION_MARK = "… [truncated]";
export const MAX_MEMBERS = 6;
const DELETED_LIMIT = 64;

export type RawAuthor = { kind: "user" | "member"; name: string; source?: string };
export type RawEntry = { id?: string; from: RawAuthor; text: string; at: number; thread?: string; truncated?: true; [extra: string]: unknown };
export type RawMember = {
  name: string;
  handle?: string;
  connectionId?: string;
  connectionKind?: string;
  connectionLabel?: string;
  sourceScoped?: true;
  [extra: string]: unknown;
};
export type RawRoom = {
  name: string;
  roomId?: string;
  log: RawEntry[];
  holdDetection?: boolean;
  revision?: number;
  members?: RawMember[];
  omitted?: number;
  image?: string;
  [extra: string]: unknown;
};
export type RawEnvelope = { version: 3; updatedAt: number; rooms: Record<string, RawRoom>; deleted: Record<string, number> };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** `normalizeGroupChatSyncSnapshot`: lift v1 (wall-clock) and v2 (name-keyed) envelopes to v3. */
export function normalizeEnvelope(snapshot: unknown): RawEnvelope {
  if (!isObj(snapshot)) return { version: 3, updatedAt: 0, rooms: {}, deleted: {} };
  const snap = clone(snapshot);
  const version = Number(snap.version || 0);
  const rooms = isObj(snap.rooms) ? (snap.rooms as Record<string, RawRoom>) : {};
  const deletedIn = isObj(snap.deleted) ? (snap.deleted as Record<string, number>) : {};
  if (version >= 3) return { version: 3, updatedAt: Number(snap.updatedAt || 0), rooms, deleted: deletedIn };
  const lifted: Record<string, RawRoom> = {};
  for (const [name, room] of Object.entries(rooms)) {
    if (!room || !Array.isArray(room.log)) continue;
    lifted[`name:${name}`] = { ...room, name };
  }
  const deleted: Record<string, number> = {};
  // v1 tombstones carried wall-clock ms, not gateway revisions — they must not outrank real revisions.
  for (const [name, at] of Object.entries(deletedIn)) deleted[`name:${name}`] = version >= 2 ? Math.max(0, Number(at || 0)) : 0;
  return { version: 3, updatedAt: Number(snap.updatedAt || 0), rooms: lifted, deleted };
}

/** `groupChatGatewayJsonSize`: conservative size of the gateway's ensure_ascii JSON encoding. */
export function groupChatGatewayJsonSize(value: unknown) {
  const json = JSON.stringify(value);
  let bytes = 0;
  for (const character of json) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x7f) {
      bytes += 1;
      if (character === "," || character === ":") bytes += 1;
    } else {
      bytes += codePoint <= 0xffff ? 6 : 12;
    }
  }
  return bytes;
}

/** `compactGroupChatSyncText`: cut to a budget and mark the cut inside the same budget. */
export function compactSyncText(text: string, limit = SYNC_TEXT_CHARS): { text: string; truncated?: true } {
  const raw = String(text || "");
  if (raw.length <= limit) return { text: raw };
  const budget = Math.max(0, limit - TRUNCATION_MARK.length);
  return { text: `${raw.slice(0, budget)}${TRUNCATION_MARK}`, truncated: true };
}

const rand5 = () => Math.random().toString(36).slice(2, 7);
/** `mintGroupRoomId`. */
export const mintRoomId = (now = Date.now()) => `r${now.toString(36)}-${rand5()}`;
/** `mintGroupThreadId`. */
export const mintThreadId = (now = Date.now()) => `t${now.toString(36)}-${rand5()}`;

/** `groupChatEntryId`: a UUID (random v4 when the runtime lacks `crypto.randomUUID`). */
export function mintEntryId(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
  const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16));
  hex[12] = "4";
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const s = hex.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

/** `uniqueGroupChatName`: " 2", " 3", … with the BASE truncated so the name stays ≤ 64 chars. */
export function uniqueGroupChatName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; n < 100; n++) {
    const suffix = ` ${n}`;
    const candidate = base.slice(0, 64 - suffix.length) + suffix;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error("No free name for the group.");
}

export const roomKeyFor = (room: Pick<RawRoom, "roomId" | "name">) => (room.roomId ? `id:${room.roomId}` : `name:${room.name}`);

/** Finds a room by its id (v3 key), else by a legacy name-keyed room whose name is the id. */
export function findRoomKey(env: RawEnvelope, roomId: string): string | null {
  if (env.rooms[`id:${roomId}`]) return `id:${roomId}`;
  for (const [key, room] of Object.entries(env.rooms)) if (room?.roomId === roomId) return key;
  if (env.rooms[`name:${roomId}`]) return `name:${roomId}`;
  return null;
}

export type NewEntry = { id: string; from: RawAuthor; text: string; thread: string };
export type MobileChange = {
  roomKey: string;
  /** A new room (its `revision` is stamped by the write). */
  addRoom?: RawRoom;
  /** Entries to append; an id already in the log is kept as-is (idempotent retries). */
  entries?: NewEntry[];
  /** Remove the room and tombstone its key. */
  disband?: boolean;
  /** Same-key field edits (v3 rooms are keyed by id, so a rename is only a display-name change). */
  patch?: { name?: string; members?: RawMember[] };
};

const lastActivity = (room: RawRoom) => Number(room?.log?.[room.log.length - 1]?.at || 0);

/** `groupChatSyncEnvelope` trim: least recently active rooms first, oldest entries first, then the image.
 *  Unlike the desktop, a room is never dropped whole — the write fails instead. */
export function trimEnvelope(env: RawEnvelope, budget = SYNC_MAX_BYTES): RawEnvelope {
  const ranked = Object.values(env.rooms).sort((a, b) => lastActivity(a) - lastActivity(b));
  for (const room of ranked) {
    while ((room.log?.length || 0) > 1 && groupChatGatewayJsonSize(serializeEnvelope(env)) > budget) {
      room.log.shift();
      room.omitted = (room.omitted || 0) + 1;
    }
    if (room.image && groupChatGatewayJsonSize(serializeEnvelope(env)) > budget) delete room.image;
  }
  if (groupChatGatewayJsonSize(serializeEnvelope(env)) > budget) throw new Error("The group chat mirror is full; it could not be updated.");
  return env;
}

/**
 * Applies a mobile change on top of the remote mirror read at revision `rev`: adds a room and/or
 * entries (strictly increasing `at`, thread always set, text compacted to 1200), stamps
 * `revision = rev + 1` only on the touched room and keeps everything else exactly as read.
 */
export function applyMobileWrite(remote: unknown, rev: number, change: MobileChange, now = Date.now()): { envelope: RawEnvelope; written: RawEntry[] } {
  const env = normalizeEnvelope(remote);
  const writeRevision = rev + 1;
  const written: RawEntry[] = [];
  if (change.disband) {
    delete env.rooms[change.roomKey];
    env.deleted[change.roomKey] = writeRevision;
  } else {
    if (change.roomKey in env.deleted && change.roomKey.startsWith("id:")) throw new Error("This group was deleted on Hermes desktop.");
    if (change.addRoom && !env.rooms[change.roomKey]) env.rooms[change.roomKey] = { ...clone(change.addRoom), log: clone(change.addRoom.log ?? []), revision: writeRevision };
    const room = env.rooms[change.roomKey];
    if (!room) throw new Error("This group no longer exists on Hermes desktop.");
    if (!Array.isArray(room.log)) room.log = [];
    if (change.patch?.name !== undefined) room.name = change.patch.name;
    if (change.patch?.members) room.members = clone(change.patch.members);
    for (const next of change.entries ?? []) {
      const existing = room.log.find((e) => e.id === next.id);
      if (existing) {
        written.push(existing);
        continue;
      }
      const at = Math.max(now, room.log.reduce((max, e) => Math.max(max, Number(e.at || 0)), 0) + 1);
      const compact = compactSyncText(next.text);
      const entry: RawEntry = { id: next.id, from: { ...next.from }, text: compact.text, at, thread: next.thread, ...(compact.truncated ? { truncated: true as const } : {}) };
      room.log.push(entry);
      written.push(entry);
    }
    room.revision = writeRevision;
  }
  env.deleted = Object.fromEntries(Object.entries(env.deleted).sort(([, a], [, b]) => Number(b || 0) - Number(a || 0)).slice(0, DELETED_LIMIT));
  env.updatedAt = now;
  return { envelope: trimEnvelope(env), written };
}

/** The mirror as the gateway stores it: `deleted` only when non-empty (desktop shape). */
export function serializeEnvelope(env: RawEnvelope): Record<string, unknown> {
  const { deleted, ...rest } = env;
  return Object.keys(deleted).length ? { ...rest, deleted } : rest;
}
