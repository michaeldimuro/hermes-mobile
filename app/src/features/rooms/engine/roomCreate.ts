/**
 * Creating and disbanding desktop group chats from mobile (spec §5): unique names, member
 * descriptors in the desktop's shape, and the room record written in one CAS update.
 */
import { findRoomKey, MAX_MEMBERS, mintRoomId, uniqueGroupChatName, type RawEnvelope, type RawMember, type RawRoom } from "./mirrorCodec";
import { updateBotGroups, writeMirror, type Call, type MirrorRead } from "./mirrorWrite";

type ProfileLike = { name: string; ui_meta?: Record<string, unknown> | null };

/** Names the desktop would treat as taken: mirror rooms, bots' `hermes-bots.groups/group`, `name:` tombstones. */
export function takenRoomNames(env: RawEnvelope, profiles: ProfileLike[]): Set<string> {
  const taken = new Set<string>();
  for (const room of Object.values(env.rooms)) if (room?.name) taken.add(String(room.name));
  for (const profile of profiles) {
    const meta = profile.ui_meta?.["hermes-bots"] as { groups?: unknown; group?: unknown } | undefined;
    if (Array.isArray(meta?.groups)) for (const g of meta.groups) if (typeof g === "string") taken.add(g);
    if (typeof meta?.group === "string" && meta.group) taken.add(meta.group);
  }
  for (const key of Object.keys(env.deleted)) if (key.startsWith("name:")) taken.add(key.slice(5));
  return taken;
}

const DESCRIPTOR_FIELDS = ["name", "handle", "connectionId", "connectionKind", "connectionLabel", "sourceScoped"] as const;

/** A member descriptor: copied from an existing local mirror descriptor for that profile, else the local default. */
export function memberDescriptor(env: RawEnvelope, profile: string, handle: string): RawMember {
  const seen = Object.values(env.rooms)
    .flatMap((room) => (Array.isArray(room?.members) ? room.members : []))
    .filter((m) => m?.name === profile);
  const existing = seen.find((m) => m.connectionId === "local") ?? seen.find((m) => !m.connectionKind || m.connectionKind === "local");
  if (existing) {
    const copy: Record<string, unknown> = {};
    for (const field of DESCRIPTOR_FIELDS) if (existing[field] !== undefined) copy[field] = existing[field];
    return copy as RawMember;
  }
  return { name: profile, handle, connectionId: "local", connectionKind: "local", connectionLabel: "This device", sourceScoped: true };
}

export type NewRoomInput = { name: string; members: string[] };
export type NewRoomPlan = { roomKey: string; roomId: string; name: string; room: RawRoom };

/** Validates input and plans the room record. Re-planning an already written room returns its own name. */
export function planNewRoom(read: Pick<MirrorRead, "envelope" | "profiles">, input: NewRoomInput, roomId: string, handleFor: (profile: string) => string): NewRoomPlan {
  const base = input.name.replace(/\s+/g, " ").trim().slice(0, 64);
  if (!base) throw new Error("Give the group a name.");
  const members = [...new Set(input.members.map((m) => m.trim()).filter(Boolean))];
  if (!members.length) throw new Error("Pick at least one bot.");
  if (members.length > MAX_MEMBERS) throw new Error(`A group can have at most ${MAX_MEMBERS} bots.`);
  const known = new Set(read.profiles.map((p) => p.name));
  const missing = members.find((m) => !known.has(m));
  if (missing) throw new Error(`No Hermes profile named ${missing}.`);
  const roomKey = `id:${roomId}`;
  const already = read.envelope.rooms[roomKey];
  const name = already?.name ?? uniqueGroupChatName(base, takenRoomNames(read.envelope, read.profiles));
  return {
    roomKey,
    roomId,
    name,
    room: { name, roomId, log: [], holdDetection: true, members: members.map((m) => memberDescriptor(read.envelope, m, handleFor(m))) },
  };
}

/** Creates the room (one CAS write), then adds it to each member's Bot Mode group list. */
export async function createDesktopRoom(call: Call, input: NewRoomInput, handleFor: (profile: string) => string) {
  const roomId = mintRoomId();
  let plan: NewRoomPlan | null = null;
  await writeMirror(call, (read) => {
    plan = planNewRoom(read, input, roomId, handleFor);
    return { roomKey: plan.roomKey, addRoom: plan.room };
  });
  const done = plan as NewRoomPlan | null;
  if (!done) throw new Error("Could not create the group.");
  const failedMeta: string[] = [];
  for (const member of done.room.members ?? []) {
    try {
      await updateBotGroups(call, member.name, { add: done.name });
    } catch {
      failedMeta.push(member.name);
    }
  }
  return { roomId: done.roomId, name: done.name, failedMeta };
}

/** Disbands a room: removes it and tombstones `id:<roomId>` (final); drops it from members' group lists. */
export async function disbandDesktopRoom(call: Call, roomId: string, opts: { members?: string[] } = {}) {
  let name = "";
  let members: string[] = opts.members ?? [];
  await writeMirror(call, (read) => {
    const key = findRoomKey(read.envelope, roomId);
    if (!key) throw new Error("This group no longer exists on Hermes desktop.");
    const room = read.envelope.rooms[key];
    name = room.name;
    if (!opts.members) members = (room.members ?? []).map((m) => m.name);
    return { roomKey: key, disband: true };
  });
  for (const member of members) await updateBotGroups(call, member, { remove: name }).catch(() => false);
  return { name };
}

/** Renames a room (display name only; the `id:` key is unchanged) and moves members' group lists. */
export async function renameDesktopRoom(call: Call, roomId: string, input: string) {
  const next = input.replace(/\s+/g, " ").trim().slice(0, 64);
  if (!next) throw new Error("Give the group a name.");
  let previous = "";
  let members: string[] = [];
  let name = next;
  await writeMirror(call, (read) => {
    const key = findRoomKey(read.envelope, roomId);
    if (!key) throw new Error("This group no longer exists on Hermes desktop.");
    if (!key.startsWith("id:")) throw new Error("Rename this older group from Hermes desktop.");
    const room = read.envelope.rooms[key];
    previous = room.name;
    members = (room.members ?? []).map((m) => m.name);
    const taken = takenRoomNames(read.envelope, read.profiles);
    taken.delete(previous);
    name = previous === next ? next : uniqueGroupChatName(next, taken);
    return { roomKey: key, patch: { name } };
  });
  if (previous && previous !== name)
    for (const member of members) {
      await updateBotGroups(call, member, { remove: previous }).catch(() => false);
      await updateBotGroups(call, member, { add: name }).catch(() => false);
    }
  return { name };
}

/** Sets a room's members (1–6 local bots), keeping existing descriptors and each bot's group list in step. */
export async function setDesktopRoomMembers(call: Call, roomId: string, wanted: string[], handleFor: (profile: string) => string) {
  const names = [...new Set(wanted.map((m) => m.trim()).filter(Boolean))];
  if (!names.length) throw new Error("A group needs at least one bot.");
  if (names.length > MAX_MEMBERS) throw new Error(`A group can have at most ${MAX_MEMBERS} bots.`);
  let roomName = "";
  let before: string[] = [];
  await writeMirror(call, (read) => {
    const key = findRoomKey(read.envelope, roomId);
    if (!key) throw new Error("This group no longer exists on Hermes desktop.");
    const room = read.envelope.rooms[key];
    roomName = room.name;
    const current = room.members ?? [];
    before = current.map((m) => m.name);
    const known = new Set(read.profiles.map((p) => p.name));
    const missing = names.find((m) => !known.has(m) && !before.includes(m));
    if (missing) throw new Error(`No Hermes profile named ${missing}.`);
    // Remote (other-machine) members can't be managed from here: they stay as they are.
    const remote = current.filter((m) => m.connectionKind && m.connectionKind !== "local" && !names.includes(m.name));
    const members = [
      ...names.map((n) => current.find((m) => m.name === n) ?? memberDescriptor(read.envelope, n, handleFor(n))),
      ...remote,
    ].slice(0, MAX_MEMBERS);
    return { roomKey: key, patch: { members } };
  });
  for (const added of names.filter((n) => !before.includes(n))) await updateBotGroups(call, added, { add: roomName }).catch(() => false);
  for (const removed of before.filter((n) => !names.includes(n))) await updateBotGroups(call, removed, { remove: roomName }).catch(() => false);
}
