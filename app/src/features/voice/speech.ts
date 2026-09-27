/** Replies are read in full up to this length; code blocks are skipped (they don't read well aloud). */
const MAX_SPEECH_CHARS = 4000;

export function speakableText(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, " (code omitted) ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>|~]+/g, "")
    .replace(/\n{2,}/g, "\n")
    .trim()
    .slice(0, MAX_SPEECH_CHARS);
}

/** Sentence ends (with trailing quotes/brackets) followed by whitespace, or a paragraph break. */
const BOUNDARY = /[.!?…]+["'”’)\]]*\s+|\n\s*\n/g;
/** Lines Hermes adds for files (`MEDIA:/path`) are for the chat, not for speaking. */
const MEDIA_LINE = /^\s*MEDIA:\S+\s*$/gm;

const openFence = (text: string) => ((text.match(/```/g) ?? []).length % 2 === 1);

/**
 * Cut a reply that is still streaming into speakable pieces, so speech starts with the first
 * sentence instead of the whole reply. `from` is where the previous call stopped; pieces shorter
 * than `minChars` wait for the next sentence (fewer, more natural TTS calls), and a cut never
 * lands inside an open code fence. With `final`, whatever is left is spoken too.
 */
export function takeSentences(text: string, from: number, final: boolean, minChars = 24) {
  const sentences: string[] = [];
  let start = from;
  const emit = (end: number) => {
    const piece = speakableText(text.slice(start, end).replace(MEDIA_LINE, ""));
    start = end;
    if (piece) sentences.push(piece);
  };
  BOUNDARY.lastIndex = from;
  for (let match = BOUNDARY.exec(text); match; match = BOUNDARY.exec(text)) {
    const end = match.index + match[0].length;
    const chunk = text.slice(start, end);
    if (openFence(chunk) || chunk.trim().length < minChars) continue;
    emit(end);
  }
  if (final && start < text.length) emit(text.length);
  return { sentences, next: start };
}
