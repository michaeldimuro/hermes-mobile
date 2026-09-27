import { createContext } from "react";
import { StyleSheet } from "react-native";
import { makeStyles, radius } from "@/ui/theme";

/** Which bot and stored session the messages on screen belong to (files download in that scope). */
export const ChatScope = createContext<{ profile: string; sessionId?: string | null }>({ profile: "default" });

/** Per-message actions the chat screen offers from a message's long-press menu. */
export type MessageActions = {
  /** Edit & resend a message of yours (rewinds the conversation to it). */
  onEdit?: (item: import("./chatReducer").UserItem) => void;
  /** Ask a side question about a reply without derailing the main thread. */
  onAskAbout?: (text: string) => void;
  /** Read a reply aloud (again to stop); `speakingId` is the reply being read. */
  onSpeak?: (id: string, text: string) => void;
  speakingId?: string | null;
};
export const MessageActionsContext = createContext<MessageActions>({});

/** Markdown styles for chat bodies (replies, teammate messages, task details). */
export const useMarkdown = makeStyles((colors, type) => ({
  body: { color: colors.text, fontSize: 16, lineHeight: 25 },
  paragraph: { marginTop: 0, marginBottom: 10 },
  heading1: {
    fontSize: 22,
    fontWeight: "700",
    marginVertical: 8,
    color: colors.text,
  },
  heading2: {
    fontSize: 19,
    fontWeight: "700",
    marginVertical: 6,
    color: colors.text,
  },
  heading3: {
    fontSize: 17,
    fontWeight: "600",
    marginVertical: 4,
    color: colors.text,
  },
  strong: { fontWeight: "700" },
  em: { fontStyle: "italic" },
  link: { color: colors.accentText, textDecorationLine: "underline" },
  bullet_list: { marginBottom: 8 },
  ordered_list: { marginBottom: 8 },
  list_item: { marginBottom: 4 },
  blockquote: {
    backgroundColor: colors.surface,
    borderLeftColor: colors.accent,
    borderLeftWidth: 3,
    paddingHorizontal: 12,
    marginVertical: 6,
  },
  code_inline: {
    ...type.mono,
    backgroundColor: colors.raised,
    color: colors.accentText,
    borderRadius: 6,
    paddingHorizontal: 5,
    borderWidth: 0,
  },
  code_block: {
    ...type.mono,
    backgroundColor: colors.surface,
    color: colors.textSoft,
    borderRadius: radius.md,
    padding: 12,
    borderWidth: 0,
  },
  fence: {
    ...type.mono,
    backgroundColor: colors.surface,
    color: colors.textSoft,
    borderRadius: radius.md,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    marginVertical: 6,
  },
  table: {
    borderColor: colors.border,
    borderRadius: radius.sm,
    marginVertical: 6,
  },
  th: { padding: 6, backgroundColor: colors.raised },
  td: { padding: 6, borderColor: colors.border },
  tr: { borderColor: colors.border },
  hr: { backgroundColor: colors.border, marginVertical: 12 },
}));
