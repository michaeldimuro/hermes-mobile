/**
 * Runs a desktop-compatible group round from mobile (spec §3, recommended design §5–6): post the
 * user entry, then serial member turns in each member's `Group: <roomId> · <thread>` session with
 * the exact desktop prompt, collecting replies into the mirror with CAS writes.
 */
import { roomHolds } from "./roomHolds";
import { compactSyncText, findRoomKey, mintEntryId, mintThreadId, type RawEntry, type RawMember, type RawRoom } from "./mirrorCodec";
import { readMirror, writeMirror, type Call, type MirrorRead } from "./mirrorWrite";
import {
  authoredByMember,
  GROUP_CHAT_MAX_CONTINUATIONS,
  GROUP_CHAT_MAX_MESSAGES,
  GROUP_CHAT_MAX_ROUNDS,
  GROUP_TURN_HARD_CAP_MS,
  GROUP_TURN_POLL_MS,
  GROUP_TURN_TIMEOUT_MS,
  groupMemberAuthor,
  groupSessionBusy,
  isDuplicateGroupAppend,
  isGroupPassText,
  lastRoomPromptAt,
  normalizeGroupChatText,
  pickGroupTurnReply,
  resolveGroupResponders,
  retainedGroupTurnError,
  rotateGroupSpeakers,
  sessionAwaitingUser,
  sessionUnavailable,
  threadOf,
  unaddressedGroupMentions,
  type SessionSnapshot,
} from "./roundPlan";
import { buildGroupChatTurnPrompt, displayName, formatGroupDeltaLines, groupMemberKey, GROUP_CHAT_HISTORY_LINE_CHARS, type EngineEntry, type EngineMember } from "./roundPrompt";

export type GatewayEventLike = { type: string; session_id?: string; payload?: unknown };
export type RunnerPort = {
  call: Call;
  onEvent: (listener: (event: GatewayEventLike) => void) => () => void;
  /** Timer used for poll backstops and CAS backoff (tests make it instant). */
  wait?: (ms: number) => Promise<void>;
  now?: () => number;
};
export type RunnerProgress = { member?: string; round?: number; note?: string } | null;
export type RunnerHooks = {
  onProgress?: (progress: RunnerProgress) => void;
  /** Optimistic entries about to be written. */
  onPending?: (entries: RawEntry[]) => void;
  /** Entries confirmed in the mirror. */
  onWritten?: (entries: RawEntry[], read: MirrorRead) => void;
  /** A member session became (in)active — requests from it should be surfaced. */
  onSession?: (runtimeId: string, member: string, active: boolean) => void;
  onNotice?: (text: string) => void;
};
export type DriveInput = { roomId: string; thread: string | null; text: string; roster: EngineMember[] };
export type DriveResult = { thread: string; posted: number; exit: "settled" | "capped" | "stopped" };

/** Mobile's per-(room, thread, member) watermark: id of the last room entry the member has seen. */
export const mobileWatermarks = new Map<string, string>();
/** Full texts of entries written from this device (the mirror copy is cut to 1200 chars). */
export const fullTexts = new Map<string, string>();

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const codeOf = (error: unknown) => (error as { code?: number } | null)?.code;

/** Room members as the engine sees them: mirror descriptors plus titles from this gateway's profiles. */
export function engineMembers(descriptors: RawMember[] | undefined, roster: EngineMember[]): EngineMember[] {
  return (descriptors ?? []).map((d) => {
    const row = roster.find((r) => r.name === d.name);
    return {
      name: d.name,
      ...(d.handle ? { handle: d.handle } : {}),
      ...(row?.title ? { title: row.title } : {}),
      ...(row?.display_name ? { display_name: row.display_name } : {}),
      ...(row?.previous_names?.length ? { previous_names: row.previous_names } : {}),
      ...(d.connectionId ? { connectionId: d.connectionId } : {}),
      ...(d.connectionKind ? { connectionKind: d.connectionKind } : {}),
      ...(d.connectionLabel ? { connectionLabel: d.connectionLabel } : {}),
      ...(d.sourceScoped ? { sourceScoped: true } : {}),
    };
  });
}

export function createGroupRunner(port: RunnerPort, hooks: RunnerHooks = {}) {
  const wait = port.wait ?? sleep;
  const now = port.now ?? Date.now;
  let stopRequested = false;
  let active: { runtime: string } | null = null;

  /** Resolves on a terminal frame for one of `ids`, or after `ms`. */
  const waitForSignal = (ids: Set<string>, ms: number) =>
    new Promise<boolean>((resolve) => {
      let done = false;
      const finish = (signalled: boolean) => {
        if (done) return;
        done = true;
        off();
        resolve(signalled);
      };
      const off = port.onEvent((event) => {
        if ((event.type === "message.complete" || event.type === "error") && event.session_id && ids.has(event.session_id)) finish(true);
      });
      void wait(ms).then(() => finish(false));
    });

  async function drive(input: DriveInput): Promise<DriveResult> {
    const { call } = port;
    const first = await readMirror(call);
    const roomKey = findRoomKey(first.envelope, input.roomId);
    if (!roomKey) throw new Error("This group no longer exists on Hermes desktop.");
    const room0 = first.envelope.rooms[roomKey];
    const members = engineMembers(room0.members, input.roster);
    const titleId = room0.roomId || room0.name;
    const thread = input.thread ?? mintThreadId(now());
    let room: RawRoom = room0;

    const logOf = (r: RawRoom): EngineEntry[] =>
      (r.log ?? []).map((e) => ({ ...e, text: (e.id && fullTexts.get(e.id)) || e.text, thread: threadOf(e) }));
    const adopt = (read: MirrorRead) => {
      const next = read.envelope.rooms[roomKey];
      if (!next) throw new Error("This group was deleted on Hermes desktop.");
      room = next;
    };
    const append = async (from: RawEntry["from"], text: string) => {
      const id = mintEntryId();
      fullTexts.set(id, text);
      hooks.onPending?.([{ id, from, text, at: now(), thread }]);
      const outcome = await writeMirror(call, { roomKey, entries: [{ id, from, text, thread }] }, { wait });
      adopt(outcome.read);
      hooks.onWritten?.(outcome.written, outcome.read);
    };

    // 1. The user's message, in the desktop's stored form (trimmed, ≤ 8000 chars).
    await append({ kind: "user", name: "You" }, compactSyncText(normalizeGroupChatText(input.text), GROUP_CHAT_HISTORY_LINE_CHARS).text);

    const failed = new Set<string>();
    let posted = 0;
    let continuations = 0;

    /** One member's turn: true = spoke, false = silent/skipped, null = the drive must stop. */
    const runMember = async (member: EngineMember, round: number): Promise<boolean | null> => {
      if (stopRequested) return null;
      if (failed.has(groupMemberKey(member))) return false;
      if (!input.roster.some((r) => r.name === member.name)) {
        hooks.onNotice?.(`${displayName(member)} isn't on this Hermes, skipped`);
        return false;
      }
      adopt(await readMirror(call));
      const log = logOf(room);
      const markKey = `${input.roomId}::${thread}::${member.name}`;
      const label = displayName(member);
      hooks.onProgress?.({ member: member.name, round });
      try {
        const title = `Group: ${titleId} · ${thread}`;
        let runtime = "";
        let stored: string | null = null;
        try {
          const res = await call<SessionSnapshot>("session.resume", { session_id: title, profile: member.name, omit_messages: true }, 180_000);
          runtime = res?.session_id ?? "";
          stored = res?.session_key || res?.stored_session_id || null;
        } catch (error) {
          if (codeOf(error) !== 4007) throw new Error(`Could not check ${member.name}'s group session, so a new one wasn't started`);
          const created = await call<{ session_id?: string; stored_session_id?: string }>(
            "session.create",
            { profile: member.name, title, hidden: true, room_plumbing: true, follow_profile_config: true },
            60_000,
          );
          runtime = created?.session_id ?? "";
          stored = created?.stored_session_id || null;
        }
        if (!runtime) throw new Error(`${member.name}'s group session did not start`);
        const target = stored || title;
        active = { runtime };
        hooks.onSession?.(runtime, member.name, true);
        try {
          // Baseline + busy check (never prompt into a session the desktop is using).
          let before = 0;
          let leftover: string | null = null;
          let snapshot: SessionSnapshot | null = null;
          const runtimeIds = new Set<string>([runtime]);
          try {
            snapshot = await call<SessionSnapshot>("session.resume", { session_id: target, profile: member.name }, 180_000);
            before = Array.isArray(snapshot?.messages) ? snapshot.messages.length : snapshot?.message_count || 0;
            leftover = retainedGroupTurnError(snapshot) === null ? null : JSON.stringify(snapshot?.inflight);
            if (snapshot?.session_id) runtimeIds.add(snapshot.session_id);
          } catch {
            // Lazy session: nothing stored yet.
          }
          if (sessionUnavailable(snapshot)) {
            hooks.onNotice?.(`${label} is busy on Hermes desktop, skipped this round`);
            return false;
          }
          // Delta since the member's last look: mobile watermark, else its last room prompt's time.
          const inThread = (e: EngineEntry) => threadOf(e) === thread;
          const mark = mobileWatermarks.get(markKey);
          let delta: EngineEntry[];
          if (mark !== undefined) {
            const idx = log.findIndex((e) => e.id === mark);
            delta = (idx >= 0 ? log.slice(idx + 1) : log).filter(inThread);
          } else {
            const since = lastRoomPromptAt(snapshot?.messages);
            delta = log.filter(inThread).filter((e) => since === null || e.at > since);
          }
          if (!delta.length) return false;
          const prompt = buildGroupChatTurnPrompt({
            groupName: room.name,
            members,
            viewer: member,
            deltaLines: formatGroupDeltaLines(delta, member, input.roster),
          });
          const anchorId = log[log.length - 1]?.id ?? null;
          let live = runtime;
          try {
            await call("prompt.submit", { session_id: runtime, text: prompt }, 60_000);
          } catch (error) {
            if (codeOf(error) !== 4001) throw error;
            const res = await call<SessionSnapshot>("session.resume", { session_id: target, profile: member.name, omit_messages: true }, 180_000);
            if (!res?.session_id) throw error;
            live = res.session_id;
            await call("prompt.submit", { session_id: live, text: prompt }, 60_000);
          }
          runtimeIds.add(live);
          active = { runtime: live };
          if (live !== runtime) hooks.onSession?.(live, member.name, true);

          const reply = await pollTurn(member, target, runtimeIds, before, leftover);
          // Commit: the member has now seen everything up to the anchor.
          if (anchorId) mobileWatermarks.set(markKey, anchorId);
          const spoke = reply !== null && !isGroupPassText(reply);
          if (spoke) {
            const author = groupMemberAuthor(member);
            const text = compactSyncText(normalizeGroupChatText(reply), GROUP_CHAT_HISTORY_LINE_CHARS).text;
            const latest = logOf(room);
            if (!isDuplicateGroupAppend(latest[latest.length - 1], author, text, thread, now())) await append(author, text);
          }
          // Step over the member's own entries (desktop `authoredByMember` rule).
          const after = logOf(room);
          let idx = anchorId ? after.findIndex((e) => e.id === anchorId) : -1;
          while (idx + 1 < after.length && authoredByMember(after[idx + 1], member)) idx += 1;
          if (idx >= 0 && after[idx]?.id) mobileWatermarks.set(markKey, after[idx].id as string);
          return spoke;
        } finally {
          for (const id of [runtime, active?.runtime]) if (id) hooks.onSession?.(id, member.name, false);
          active = null;
        }
      } catch (error) {
        if (error instanceof Error && /deleted on Hermes|no longer exists/.test(error.message)) throw error;
        failed.add(groupMemberKey(member));
        hooks.onNotice?.(`${label} couldn't reply: ${error instanceof Error ? error.message : "turn failed"}`);
        return false;
      }
    };

    /** `pollGroupMemberTurn`: wait for the terminal frame (or 5 s), then read the session. */
    async function pollTurn(member: EngineMember, target: string, runtimeIds: Set<string>, before: number, leftover: string | null) {
      const started = now();
      let deadline = started + GROUP_TURN_TIMEOUT_MS;
      let quick = 0;
      while (now() < deadline) {
        const signalled = await waitForSignal(quick ? new Set<string>() : runtimeIds, quick ? 250 : GROUP_TURN_POLL_MS);
        quick = signalled ? 8 : Math.max(0, quick - 1);
        let state: SessionSnapshot | null = null;
        try {
          state = await port.call<SessionSnapshot>("session.resume", { session_id: target, profile: member.name }, 180_000);
        } catch {
          continue;
        }
        if (state?.session_id) runtimeIds.add(state.session_id);
        const messages = Array.isArray(state?.messages) ? state.messages : [];
        const busy = groupSessionBusy(state);
        const awaiting = sessionAwaitingUser(state);
        const failure = retainedGroupTurnError(state);
        const died = failure !== null && (messages.length > before || JSON.stringify(state?.inflight) !== leftover);
        if ((messages.length > before || died) && !busy && !awaiting) {
          const reply = messages.length > before ? pickGroupTurnReply(messages, before) : null;
          if (reply !== null) return reply;
          if (failure !== null) throw new Error(failure);
          return null;
        }
        if (busy || awaiting) deadline = Math.min(started + GROUP_TURN_HARD_CAP_MS, Math.max(deadline, now() + GROUP_TURN_TIMEOUT_MS));
      }
      hooks.onNotice?.(`${displayName(member)} is taking long; its reply will show up in the desktop app`);
      return null;
    }

    let exit: DriveResult["exit"] = "settled";
    try {
      rounds: for (let round = 0; round < GROUP_CHAT_MAX_ROUNDS; round++) {
        const threadLog = logOf(room).filter((e) => threadOf(e) === thread);
        // Members the user told to stop (desktop #93129 holds) sit out until addressed again.
        const held = roomHolds(logOf(room), members, room.holdDetection !== false);
        const responders = rotateGroupSpeakers(resolveGroupResponders(threadLog, members), round).filter(
          (member) => !held.has(groupMemberKey(member)),
        );
        let spoke = 0;
        for (const member of responders) {
          if (stopRequested) return { thread, posted, exit: "stopped" };
          if (posted >= GROUP_CHAT_MAX_MESSAGES) {
            exit = "capped";
            break rounds;
          }
          const result = await runMember(member, round + 1);
          if (result === null) return { thread, posted, exit: "stopped" };
          if (result) {
            posted += 1;
            spoke += 1;
          }
        }
        if (spoke === 0) {
          const pending = unaddressedGroupMentions(logOf(room).filter((e) => threadOf(e) === thread), members);
          continuations += 1;
          if (pending.length && continuations <= GROUP_CHAT_MAX_CONTINUATIONS && posted < GROUP_CHAT_MAX_MESSAGES) {
            for (const member of members.filter((m) => pending.includes(groupMemberKey(m)) && !held.has(groupMemberKey(m)))) {
              if (stopRequested) return { thread, posted, exit: "stopped" };
              if (posted >= GROUP_CHAT_MAX_MESSAGES) break;
              const result = await runMember(member, round + 1);
              if (result === null) return { thread, posted, exit: "stopped" };
              if (result) {
                posted += 1;
                spoke += 1;
              }
            }
          }
          if (spoke === 0) {
            if (pending.length && (continuations > GROUP_CHAT_MAX_CONTINUATIONS || posted >= GROUP_CHAT_MAX_MESSAGES)) exit = "capped";
            return { thread, posted, exit };
          }
        }
        if (round === GROUP_CHAT_MAX_ROUNDS - 1) exit = "capped";
      }
      return { thread, posted, exit };
    } finally {
      hooks.onProgress?.(null);
    }
  }

  /** Stop after the current turn; interrupt the member working right now. */
  function stop() {
    stopRequested = true;
    const current = active;
    if (current) void port.call("session.interrupt", { session_id: current.runtime }, 10_000).catch(() => undefined);
  }

  return { drive, stop, get stopping() {
    return stopRequested;
  } };
}

export type GroupRunner = ReturnType<typeof createGroupRunner>;
