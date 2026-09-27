/**
 * Sticky per-member "stop" holds — a port of the desktop's #93129 rules (`group-rounds.ts`
 * classifyGroupHoldDirective / applyGroupHoldDirective). The desktop keeps holds locally, but it
 * derives them purely from USER messages in the room log, which the mirror shares; replaying the
 * log here gives the phone the same view: "stop @cto" holds CTO until it is addressed again.
 */
import { groupMemberKey, type EngineEntry, type EngineMember } from "./roundPrompt";
import { parseGroupChatMentions } from "./roundPlan";

/** Quoted / pasted spans are content, not directives: keep only their @tokens (#117040). */
function maskQuotedAndCodeSpans(value: string): string {
  const mentionsOnly = (span: string) => (span.match(/@[\p{L}\p{N}._-]+/gu) || []).join(" ") || "quoted";
  const kept: string[] = [];
  let fence = "";
  for (const line of value.split("\n")) {
    if (fence) {
      const closing = line.trim().startsWith(fence);
      kept.push(closing ? "" : mentionsOnly(line));
      if (closing) fence = "";
      continue;
    }
    const opened = line.match(/^\s*(`{3,}|~{3,})/);
    if (opened) {
      fence = opened[1];
      continue;
    }
    if (/^\s*>/.test(line)) {
      kept.push(mentionsOnly(line));
      continue;
    }
    kept.push(line.replace(/`[^`\n]*`/g, mentionsOnly).replace(/["“”][^"“”\n]*["“”]/g, mentionsOnly));
  }
  return kept.join("\n");
}

/** `adjacent`: a stop/halt/pause word within two words of a mention; `distant`: one elsewhere. */
export function stopWordPlacement(value: string): "adjacent" | "distant" | null {
  const tokens = maskQuotedAndCodeSpans(value).toLowerCase().match(/@[\p{L}\p{N}._-]+|[\p{L}\p{N}_-]+/gu) || [];
  const mentionAt: number[] = [];
  const stopAt: number[] = [];
  tokens.forEach((token, index) => {
    if (token.startsWith("@")) mentionAt.push(index);
    else if (token === "stop" || token === "halt" || token === "pause") stopAt.push(index);
  });
  if (stopAt.some((stop) => mentionAt.some((mention) => Math.abs(stop - mention) <= 2))) return "adjacent";
  return stopAt.length ? "distant" : null;
}

/** Held member keys after replaying every user message in the log (oldest first). */
export function roomHolds(log: EngineEntry[], members: EngineMember[], holdDetection = true): Set<string> {
  const held = new Set<string>();
  if (!holdDetection) return held;
  const all = members.map(groupMemberKey);
  for (const entry of log) {
    if (entry.from.kind !== "user") continue;
    const { everyone, mentioned } = parseGroupChatMentions(entry.text, members);
    const stop = stopWordPlacement(entry.text);
    if (stop === "adjacent") {
      for (const key of everyone ? all : mentioned) held.add(key);
    } else if (stop === null && everyone) {
      held.clear();
    } else if (stop === null) {
      for (const key of mentioned) held.delete(key);
    }
  }
  return held;
}

/** The message the phone posts to pause / resume a member, in the words the desktop recognises. */
export const holdText = (handle: string, pause: boolean) => (pause ? `stop @${handle}` : `@${handle} resume`);

/** Profile names currently held in a room, for display (mirror members + roster titles for @forms). */
export function heldMemberNames(
  log: EngineEntry[],
  members: { name: string; handle?: string }[],
  roster: EngineMember[],
  holdDetection = true,
): Set<string> {
  const engine: EngineMember[] = members.map((m) => ({ ...(roster.find((r) => r.name === m.name) ?? {}), name: m.name, handle: m.handle }));
  const held = roomHolds(log, engine, holdDetection);
  return new Set(engine.filter((m) => held.has(groupMemberKey(m))).map((m) => m.name));
}
