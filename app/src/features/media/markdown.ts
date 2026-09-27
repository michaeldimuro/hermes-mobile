import { MarkdownIt } from "react-native-markdown-display";

/**
 * Shared markdown-it instance: linkify turns plain `https://…` text into links. Fuzzy links are off
 * so file names like `README.md` or `notes.sh` (valid TLDs) are never turned into web links.
 */
export const markdownParser = MarkdownIt({ typographer: false, linkify: true });
markdownParser.linkify.set({ fuzzyLink: false, fuzzyEmail: false, fuzzyIP: false });
