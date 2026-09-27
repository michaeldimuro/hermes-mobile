/**
 * Something shared into Hermes from another app, waiting for the chat it was sent to. The share
 * screen stages it here and opens a new chat; that chat consumes it once (draft + attachments).
 */
export type SharedItem = { kind: "text" | "url" | "image" | "file"; value: string; name?: string; mimeType?: string | null };
export type PendingShare = { bot: string; note: string; items: SharedItem[] };

let pending: PendingShare | null = null;

export function stageShare(share: PendingShare) {
  pending = share;
}

/** Takes the staged share for `bot` (once). */
export function takeShare(bot: string): PendingShare | null {
  if (!pending || pending.bot !== bot) return null;
  const share = pending;
  pending = null;
  return share;
}

/** The composer text for a share: the note, then any shared text and links. */
export function shareDraft(share: PendingShare) {
  const parts = [share.note.trim(), ...share.items.filter((i) => i.kind === "text" || i.kind === "url").map((i) => i.value.trim())];
  return parts.filter(Boolean).join("\n\n");
}
