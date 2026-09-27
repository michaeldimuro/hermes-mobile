/**
 * Byte-exact ports of the desktop's member-turn prompt (`group-round-prompt.ts`) and the identity
 * helpers it depends on (`data.ts` botHandle / mentionNameForms / botMentionTag, `labels.ts`
 * displayName, `group-chat.ts` groupSpeakerLabel).
 */
import { compactSyncText, TRUNCATION_MARK } from "./mirrorCodec";

export const GROUP_CHAT_HISTORY_LIMIT = 200;
export const GROUP_CHAT_HISTORY_CHARS = 32_000;
export const GROUP_CHAT_HISTORY_LINE_CHARS = 8_000;
export const GROUP_PROMPT_HEADER_PREFIX = '[Group chat: "';
export { TRUNCATION_MARK };

/** A room member as the engine sees it: the mirror descriptor plus friendly identity from its profile. */
export type EngineMember = {
  name: string;
  handle?: string;
  /** Bot Mode title (`ui_meta["hermes-bots"].title`). */
  title?: string | null;
  display_name?: string;
  previous_names?: string[];
  connectionId?: string;
  connectionKind?: string;
  connectionLabel?: string;
  sourceScoped?: boolean;
  remoteSource?: boolean;
  installId?: string;
};
export type EngineAuthor = { kind: "user" | "member"; name?: string; source?: string; gateway?: string };
export type EngineEntry = {
  id?: string;
  from: EngineAuthor;
  text: string;
  at: number;
  thread?: string;
  images?: { kind?: string; name?: string }[];
};

/** `botHandle`: an explicit different handle wins, `default` is `hermes`, else the profile name. */
export function botHandle(name: string, bot?: { handle?: string } | null): string {
  if (bot?.handle && bot.handle !== name) return bot.handle;
  return (name || "").trim().toLowerCase() === "default" ? "hermes" : name;
}

/** `mentionNameForms`: slug and collapsed forms of a friendly name, reserved words dropped. */
export function mentionNameForms(value: string | null | undefined): string[] {
  const name = String(value || "").trim().toLowerCase();
  if (!name) return [];
  const slug = name.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  const collapsed = name.replace(/[^a-z0-9_-]+/g, "");
  return [...new Set([slug, collapsed])].filter(
    (form) => /^[a-z0-9][a-z0-9_-]*$/.test(form) && !["all", "everyone", "user", "default", "hermes"].includes(form),
  );
}

/** `botFriendlyNames` as far as a phone can know them: Bot Mode title, then the profile display name. */
export const botFriendlyNames = (bot: EngineMember): (string | null | undefined)[] => [bot.title, bot.display_name];

/** `botMentionTag`: the friendly slug when the bot has a real name, else its @handle. */
export function botMentionTag(bot: EngineMember): string {
  for (const friendly of botFriendlyNames(bot)) {
    const forms = mentionNameForms(friendly);
    if (forms.length) return forms[0];
  }
  return botHandle(bot.name, bot);
}

const titleCase = (raw: string) => raw.replace(/[-_]+/g, " ").trim().replace(/\b\w/g, (ch) => ch.toUpperCase());

/** `displayName` (labels.ts) for a local row. */
export function displayName(bot: EngineMember): string {
  if (bot.title?.trim()) return bot.title.trim();
  if (typeof bot.display_name === "string" && bot.display_name.trim()) return bot.display_name.trim();
  if ((bot.name || "").trim().toLowerCase() === "default" && !bot.title) return "Hermes";
  return titleCase(bot.title || bot.name || "");
}

/** `groupSpeakerLabel` for a raw profile name against the known roster. */
export function speakerLabel(name: string | undefined, roster: EngineMember[]): string {
  const trimmed = (name || "").trim();
  if (!trimmed) return trimmed;
  const isDefault = trimmed.toLowerCase() === "default";
  const named = roster.filter((bot) => bot.name === trimmed && !(isDefault && (bot.remoteSource || bot.sourceScoped)));
  if (named.length === 1) return displayName(named[0]);
  const row = roster.find((bot) => bot.name === trimmed && !bot.remoteSource);
  if (row?.title?.trim()) return row.title.trim();
  if (row?.display_name?.trim()) return row.display_name.trim();
  return isDefault ? "Hermes" : trimmed;
}

const MEMBER_CONTROL_FRAME_RE =
  /\[(?=\/?OUT-OF-BAND USER MESSAGE|CONTEXT COMPACTION|CONTEXT SUMMARY\]|PRIOR CONTEXT|Runtime note:|System note:|System:|SYSTEM\]|IMPORTANT:|Planning state preserved|ASYNC DELEGATION)/gi;

export const relabelMemberControlFrames = (text: string) => text.replace(MEMBER_CONTROL_FRAME_RE, "[member-quoted ");

function isGroupChatSelf(from: EngineAuthor, viewer: EngineMember): boolean {
  if (!from.name || from.name !== viewer.name) return false;
  if (from.gateway && viewer.installId) return from.gateway === viewer.installId;
  const speakerSource = from.source || "";
  if (!speakerSource) return !viewer.remoteSource;
  return [viewer.connectionLabel, viewer.connectionId].filter(Boolean).includes(speakerSource);
}

/** `formatGroupChatLine`: `Name (user): …` / `Label[ (you)][ [source]]: …`. */
export function formatGroupChatLine(entry: EngineEntry, viewer: EngineMember, roster: EngineMember[] = []): string {
  const attached =
    Array.isArray(entry.images) && entry.images.length
      ? ` ${entry.images
          .map((img) => `[${img.kind === "pdf" ? "attached PDF" : img.kind === "file" ? "attached file" : "attached image"}: ${img.name || "image"}]`)
          .join(" ")}`
      : "";
  if (entry.from.kind === "user") return `${entry.from.name || "User"} (user): ${entry.text}${attached}`;
  const suffix = isGroupChatSelf(entry.from, viewer) ? " (you)" : "";
  const source = entry.from.source ? ` [${entry.from.source}]` : "";
  return `${speakerLabel(entry.from.name, roster)}${suffix}${source}: ${relabelMemberControlFrames(entry.text)}${attached}`;
}

/** `formatGroupDeltaLines`: newest lines that fit 200 lines / 32k chars, bodies cut to 8000. */
export function formatGroupDeltaLines(delta: EngineEntry[], viewer: EngineMember, roster: EngineMember[] = []): string[] {
  const lines: string[] = [];
  let chars = 0;
  for (let i = delta.length - 1; i >= 0 && lines.length < GROUP_CHAT_HISTORY_LIMIT; i--) {
    const entry = delta[i];
    const line = formatGroupChatLine({ ...entry, text: compactSyncText(entry.text, GROUP_CHAT_HISTORY_LINE_CHARS).text }, viewer, roster);
    if (lines.length && chars + line.length > GROUP_CHAT_HISTORY_CHARS) break;
    lines.push(line);
    chars += line.length + 1;
  }
  lines.reverse();
  const omitted = delta.length - lines.length;
  if (omitted > 0) lines.unshift(`… ${omitted} earlier room message${omitted === 1 ? "" : "s"} omitted since your last turn`);
  return lines;
}

/** `groupMemberKey`. */
export const groupMemberKey = (member: EngineMember) =>
  member.sourceScoped || member.remoteSource ? `${member.connectionId || "legacy"}::${member.name || "default"}` : member.name;

/** `buildGroupChatTurnPrompt`: the full per-turn payload for one member. */
export function buildGroupChatTurnPrompt({
  groupName,
  members,
  viewer,
  deltaLines,
}: {
  groupName: string;
  members: EngineMember[];
  viewer: EngineMember;
  deltaLines: string[];
}): string {
  const viewerKey = groupMemberKey(viewer);
  const peers = members.filter((m) => groupMemberKey(m) !== viewerKey);
  const peerNames = peers
    .map((m) => {
      const handle = m.title ? `${m.title} (@${botMentionTag(m)})` : `@${botMentionTag(m)}`;
      return m.remoteSource ? `${handle} [on ${m.connectionLabel || m.connectionId}]` : handle;
    })
    .join(", ");
  return [
    `${GROUP_PROMPT_HEADER_PREFIX}${groupName}"] You are @${botMentionTag(viewer)}, one participant in a group chat with ${peerNames || "no one else yet"} and the user.`,
    "",
    "New messages in the room since your last turn (oldest first):",
    ...deltaLines.map((line) => `  ${line}`),
    "",
    "Rules for this room:",
    "- Reply with ONE conversational message ONLY if you have something new worth adding: build on what was just said, claim or hand off work, answer a question aimed at you, or report a real result. Keep chatter short (1-3 sentences) — but when you are delivering a result, an answer the user asked for, or substantive work, give it at full quality and length; never thin out real content to fit the room.",
    '- If you have nothing new to add, reply with exactly "(pass)". Passing is good — it lets the conversation settle.',
    "- Mention a teammate as @name to pull them in; mention @user only for a judgment call or a result the user needs. Do not repeat points already made.",
    "- Never reveal content from your private 1:1 chats. Your reply text goes to the room verbatim — no preamble, no meta-commentary.",
  ].join("\n");
}
