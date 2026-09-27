import type { ProfileRow } from "@/lib/gateway/types";

/**
 * `@bot` mentions, compatible with Hermes desktop's Bot Mode (hermes-bots plugin): a mention does not
 * forward the message — the prompt gets a note naming the referenced agents so the bot can contact
 * them with its `message_agent` tool (available in each bot's canonical "Bot Chat").
 */

type BotMeta = { title?: string; handle?: string };
const meta = (bot: ProfileRow): BotMeta => ((bot.ui_meta?.["hermes-bots"] as BotMeta | undefined) ?? {});

/** The @-handle a bot answers to (desktop `botHandle`): explicit handle, `hermes` for default, else its name. */
export function botHandle(bot: ProfileRow) {
  const handle = meta(bot).handle?.trim();
  if (handle && handle !== bot.name) return handle;
  return bot.name.trim().toLowerCase() === "default" ? "hermes" : bot.name;
}

/** Friendly Bot Mode title ("Chief Technology Officer"), if the desktop set one. */
export function botModeTitle(bot: ProfileRow) {
  return (meta(bot).title ?? "").trim();
}

const slug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Every lower-cased token that should resolve to this bot. */
export function mentionAliases(bot: ProfileRow): string[] {
  const names = [botHandle(bot), bot.name, bot.display_name ?? "", botModeTitle(bot)];
  const out = new Set<string>();
  for (const name of names.filter(Boolean)) {
    out.add(name.toLowerCase());
    out.add(slug(name));
    out.add(slug(name).replace(/-/g, ""));
  }
  out.delete("");
  return [...out];
}

/** Bots referenced by `@token`s in `text`, in order of first mention. */
export function resolveMentions(text: string, bots: ProfileRow[]): ProfileRow[] {
  const found: ProfileRow[] = [];
  for (const match of text.matchAll(/(^|\s)@([a-z0-9][a-z0-9_-]*)/gi)) {
    const token = match[2].toLowerCase();
    const bot = bots.find((candidate) => mentionAliases(candidate).includes(token));
    if (bot && !found.includes(bot)) found.push(bot);
  }
  return found;
}

const NOTE_PREFIX = "\n\n[@mentions resolved from the Bot Mode roster — the user is referring to: ";

/** The model-facing note desktop appends after a message that mentions bots (byte-compatible). */
export function mentionNote(bots: ProfileRow[]) {
  if (!bots.length) return "";
  const lines = bots.map((bot) => {
    const handle = botHandle(bot);
    const title = botModeTitle(bot);
    const target = bot.name.trim().toLowerCase() === "default" ? "hermes" : bot.name;
    const where = handle !== target ? ` (message_agent target: "${target}")` : "";
    return `@${handle} = agent profile "${bot.name}"${title ? ` ("${title}")` : ""}${where}`;
  });
  return (
    NOTE_PREFIX +
    lines.join("; ") +
    ". If they want one of these agents contacted, compose your own message and send it with your message_agent tool (agents on other connected machines are reachable too — the Desktop relays it); never forward the user’s text verbatim. If this session has no message_agent tool, agent messaging is unavailable here — say so.]"
  );
}

/** Drop the mention note from a stored user message so bubbles show what the user typed. */
export function stripMentionNote(text: string) {
  const index = text.indexOf(NOTE_PREFIX);
  return index >= 0 ? text.slice(0, index) : text;
}
