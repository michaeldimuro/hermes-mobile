/**
 * Compare-and-swap writes to the desktop group mirror (`group-chat.ts:1173-1251`) and to a member's
 * Bot Mode metadata. Every attempt re-reads, re-applies the change on the fresh copy and writes with
 * `ui_meta_expected_revisions`; `applied.ui_meta !== true` (conflict or oversize) retries.
 */
import { applyMobileWrite, GROUPS_KEY, normalizeEnvelope, serializeEnvelope, type MobileChange, type RawEntry, type RawEnvelope } from "./mirrorCodec";

export type Call = <T>(method: string, params?: Record<string, unknown>, timeoutMs?: number) => Promise<T>;
type ProfileRowLike = { name: string; is_default?: boolean; ui_meta?: Record<string, unknown> | null; ui_meta_revisions?: Record<string, number> | null };
type ConfigureResult = { applied?: { ui_meta?: boolean; ui_meta_revisions?: Record<string, number>; ui_meta_conflicts?: unknown } };

export const MAX_ATTEMPTS = 6;
const backoff = (attempt: number) => Math.min(4_000, 250 * 2 ** attempt);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export type MirrorRead = { envelope: RawEnvelope; revision: number; supportsCas: boolean; profiles: ProfileRowLike[] };

/** Reads the mirror and its revision from the default profile row. */
export async function readMirror(call: Call): Promise<MirrorRead> {
  const result = await call<{ profiles?: ProfileRowLike[] }>("profiles.list", { include_sessions: false }, 20_000);
  const profiles = Array.isArray(result?.profiles) ? result.profiles : [];
  const row = profiles.find((p) => p?.name === "default");
  if (!row) throw new Error("Hermes has no default profile to hold group chats.");
  const revisions = row.ui_meta_revisions;
  return {
    envelope: normalizeEnvelope(row.ui_meta?.[GROUPS_KEY]),
    revision: Number(revisions?.[GROUPS_KEY] || 0),
    supportsCas: Boolean(revisions && typeof revisions === "object"),
    profiles,
  };
}

/** Listeners told about every confirmed mirror write (so views refresh without waiting to poll). */
type WriteListener = (read: MirrorRead) => void;
const listeners = new Set<WriteListener>();
export function onMirrorWrite(listener: WriteListener) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export type CasOutcome = { written: RawEntry[]; revision: number; read: MirrorRead };

/** Applies `change` with CAS, retrying conflicts; verifies the read-back revision. */
export async function writeMirror(call: Call, change: MobileChange | ((read: MirrorRead) => MobileChange), opts: { wait?: (ms: number) => Promise<void> } = {}): Promise<CasOutcome> {
  const wait = opts.wait ?? sleep;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt) await wait(backoff(attempt - 1));
    try {
      const read = await readMirror(call);
      const resolved = typeof change === "function" ? change(read) : change;
      const { envelope, written } = applyMobileWrite(read.envelope, read.revision, resolved);
      const writeRevision = read.revision + 1;
      const params: Record<string, unknown> = { name: "default", ui_meta: { [GROUPS_KEY]: serializeEnvelope(envelope) } };
      if (read.supportsCas) params.ui_meta_expected_revisions = { [GROUPS_KEY]: read.revision };
      const result = await call<ConfigureResult>("profiles.configure", params, 20_000);
      if (result?.applied?.ui_meta !== true) throw new Error("Hermes rejected the group chat update (conflict or size).");
      if (read.supportsCas && Number(result.applied.ui_meta_revisions?.[GROUPS_KEY] || 0) !== writeRevision)
        throw new Error("Hermes did not advance the group chat revision.");
      const confirmed = await readMirror(call);
      if (read.supportsCas && confirmed.revision < writeRevision) throw new Error("Group chat revision missing after read-back.");
      listeners.forEach((listener) => listener(confirmed));
      return { written, revision: writeRevision, read: confirmed };
    } catch (error) {
      lastError = error;
      if (error instanceof Error && /deleted on Hermes|no longer exists|mirror is full|No free name/.test(error.message)) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Could not update the group chat.");
}

export type BotGroupsEdit = { add?: string; remove?: string };

/** CAS read-modify-write of a member's `ui_meta["hermes-bots"]` room list (`groups`, `group = groups[0]`). */
export async function updateBotGroups(call: Call, profile: string, edit: BotGroupsEdit, opts: { wait?: (ms: number) => Promise<void> } = {}) {
  const wait = opts.wait ?? sleep;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt) await wait(backoff(attempt - 1));
    const result = await call<{ profiles?: ProfileRowLike[] }>("profiles.list", { include_sessions: false }, 20_000);
    const row = (result?.profiles ?? []).find((p) => p?.name === profile);
    if (!row) throw new Error(`No Hermes profile named ${profile}.`);
    const current = (row.ui_meta?.["hermes-bots"] as Record<string, unknown> | undefined) ?? {};
    const existing = Array.isArray(current.groups) ? current.groups.filter((g): g is string => typeof g === "string") : typeof current.group === "string" && current.group ? [current.group] : [];
    let groups = existing;
    if (edit.add && !groups.includes(edit.add)) groups = [...groups, edit.add];
    if (edit.remove) groups = groups.filter((g) => g !== edit.remove);
    if (groups.length === existing.length && groups.every((g, i) => g === existing[i])) return false;
    const next: Record<string, unknown> = { ...current, groups };
    if (groups.length) next.group = groups[0];
    else delete next.group;
    const revision = Number(row.ui_meta_revisions?.["hermes-bots"] || 0);
    const res = await call<ConfigureResult>(
      "profiles.configure",
      { name: profile, ui_meta: { "hermes-bots": next }, ui_meta_expected_revisions: { "hermes-bots": revision } },
      20_000,
    );
    if (res?.applied?.ui_meta === true) return true;
  }
  throw new Error(`Could not update ${profile}'s group list.`);
}
