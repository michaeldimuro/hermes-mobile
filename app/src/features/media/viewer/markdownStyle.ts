import { StyleSheet } from "react-native";
import { makeStyles, radius } from "@/ui/theme";

/** Markdown theme for the document viewer — matches the chat bubble styling in MessageItem. */
export const useDocumentMarkdownStyle = makeStyles((colors, type) => ({
  body: { color: colors.text, fontSize: 16, lineHeight: 25 },
  paragraph: { marginTop: 0, marginBottom: 12 },
  heading1: { fontSize: 24, fontWeight: "700", marginVertical: 10, color: colors.text },
  heading2: { fontSize: 20, fontWeight: "700", marginVertical: 8, color: colors.text },
  heading3: { fontSize: 17, fontWeight: "600", marginVertical: 6, color: colors.text },
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
  code_inline: { ...type.mono, backgroundColor: colors.raised, color: colors.accentText, borderRadius: 6, paddingHorizontal: 5, borderWidth: 0 },
  code_block: { ...type.mono, backgroundColor: colors.surface, color: colors.textSoft, borderRadius: radius.md, padding: 12, borderWidth: 0 },
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
  table: { borderColor: colors.border, borderRadius: radius.sm, marginVertical: 6 },
  th: { padding: 6, backgroundColor: colors.raised },
  td: { padding: 6, borderColor: colors.border },
  tr: { borderColor: colors.border },
  hr: { backgroundColor: colors.border, marginVertical: 12 },
}));
