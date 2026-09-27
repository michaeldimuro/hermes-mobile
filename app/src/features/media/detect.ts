/**
 * Pure attachment/link detection for assistant replies. Mirrors Hermes conventions:
 *  - `MEDIA:<path>` directives (gateway/platforms/base.py MEDIA_TAG_CLEANUP_RE; desktop parts.ts) —
 *    removed from the text and rendered as cards. Unquoted paths may contain spaces when they end
 *    in a known extension; quoted/backticked values are taken verbatim.
 *  - markdown links / images pointing at absolute gateway paths or gateway file URLs,
 *  - bare absolute paths with a known extension, and http(s) URLs.
 * No React Native imports so it runs under plain Jest.
 */
import { extensionOf, fileNameOf, isDeliverableExt, KNOWN_EXTS, kindOf, type MediaKind } from "./kinds";

export type AttachmentOrigin = "media" | "markdown-link" | "bare-path" | "url" | "tool";

export type Attachment = {
  /** Stable identity: `path:<path>` or `url:<url>`. */
  key: string;
  /** File on the gateway machine (absolute, `~/…`, or session-relative for tools). */
  path?: string;
  /** Remote http(s) file (downloaded without gateway credentials). */
  url?: string;
  name: string;
  kind: MediaKind;
  ext: string;
  origin: AttachmentOrigin;
};

export type Detection = {
  /** Text to render as markdown: `MEDIA:` directives and delivery markers removed. */
  text: string;
  attachments: Attachment[];
  /** Web page URLs (not files), in order of appearance — link-preview candidates. */
  links: string[];
};

/** Where a markdown href/src should go. */
export type HrefTarget =
  | { type: "file"; path: string }
  | { type: "remote-file"; url: string }
  | { type: "web"; url: string }
  | { type: "none" };

const MAX_ATTACHMENTS = 12;
const EXT_ALT = KNOWN_EXTS.join("|");
const ANCHORED_PATH = `(?:~/|/|[A-Za-z]:[/\\\\])\\S+?(?:[^\\S\\n]+\\S+?)*?\\.(?:${EXT_ALT})(?=[\\s\`"'*_,;:)\\]}]|MEDIA:|$)`;
const MEDIA_VALUE = `(\`[^\`\\n]+\`|"[^"\\n]+"|'[^'\\n]+'|${ANCHORED_PATH}|\\S+)`;
const MEDIA_LINE_RE = new RegExp(`(^|\\n)[\\t ]*[*_]{0,3}[\`"']?MEDIA:\\s*${MEDIA_VALUE}[\`"']?[*_]{0,3}[\\t ]*(?=\\n|$)`, "gi");
const MEDIA_TAG_RE = new RegExp(`[\`"']?MEDIA:\\s*${MEDIA_VALUE}[\`"']?`, "gi");
const MARKERS_RE = /\[\[(?:audio_as_voice|as_document)\]\]/g;
const MD_LINK_RE = /(!?)\[((?:[^\][]|\[[^\]]*\])*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const BARE_PATH_RE =
  /(^|[\s("'`[{])((?:~\/|\/|[A-Za-z]:[\\/])[^\s"'`<>()[\]{}|*]*?\.([A-Za-z0-9]{1,8}))(?=$|[\s"'`<>()[\]{},;:!?*]|\.(?:\s|$))/g;
const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/gi;
const LOCAL_PATH_RE = /^(?:~\/|\/(?!\/)|[A-Za-z]:[\\/])/;
const GATEWAY_FILE_ROUTES = new Set([
  "/api/fs/download",
  "/api/fs/read-data-url",
  "/api/files/download",
  "/api/files/stream",
  "/api/files/read",
  "/api/media",
]);

type Segment = { code: boolean; text: string };

/** Split markdown into fenced-code and prose segments (an unclosed fence runs to the end). */
export function splitFences(text: string): Segment[] {
  const segments: Segment[] = [];
  const lines = text.split("\n");
  let fence: string | null = null;
  let buffer: string[] = [];
  const flush = (code: boolean) => {
    if (buffer.length) segments.push({ code, text: buffer.join("\n") });
    buffer = [];
  };
  lines.forEach((line) => {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence === null && marker) {
      flush(false);
      fence = marker;
      buffer.push(line);
    } else if (fence !== null && marker && marker[0] === fence[0] && marker.length >= fence.length) {
      buffer.push(line);
      flush(true);
      fence = null;
    } else buffer.push(line);
  });
  flush(fence !== null);
  // Re-join with the newlines the split consumed between segments.
  return segments.map((segment, index) => (index < segments.length - 1 ? { ...segment, text: `${segment.text}\n` } : segment));
}

function unquote(value: string) {
  const trimmed = value.trim();
  const quote = trimmed[0];
  return quote && quote === trimmed.at(-1) && trimmed.length > 1 && "\"'`".includes(quote) ? trimmed.slice(1, -1) : trimmed;
}

function trimUrl(raw: string) {
  let url = raw.replace(/[.,;:!?*_]+$/, "");
  while (/[)\]}]$/.test(url)) {
    const close = url.at(-1) as string;
    const open = close === ")" ? "(" : close === "]" ? "[" : "{";
    if (url.split(open).length >= url.split(close).length) break;
    url = url.slice(0, -1).replace(/[.,;:!?*_]+$/, "");
  }
  return url;
}

function safeDecode(value: string) {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

export function isLocalPath(value: string): boolean {
  return LOCAL_PATH_RE.test(value) && !value.includes("\0");
}

/** Recognise a URL that points at a Hermes gateway file route and return the file path it names. */
export function gatewayPathFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol) || !GATEWAY_FILE_ROUTES.has(parsed.pathname.replace(/\/+$/, ""))) return null;
    const path = parsed.searchParams.get("path");
    return path && (isLocalPath(path) || path.startsWith("file:")) ? filePathFromUri(path) : null;
  } catch {
    return null;
  }
}

function filePathFromUri(value: string) {
  if (!/^file:/i.test(value)) return value;
  try {
    return decodeURIComponent(new URL(value).pathname);
  } catch {
    return value.replace(/^file:\/\//i, "");
  }
}

/** Classify a markdown href / image src (markdown-it percent-encodes these, so decode first). */
export function resolveHref(href: string | undefined | null): HrefTarget {
  if (!href) return { type: "none" };
  const raw = href.trim();
  if (/^file:/i.test(raw)) return { type: "file", path: filePathFromUri(raw) };
  if (/^https?:\/\//i.test(raw)) {
    const gatewayPath = gatewayPathFromUrl(raw);
    if (gatewayPath) return { type: "file", path: gatewayPath };
    return isFileUrl(raw) ? { type: "remote-file", url: raw } : { type: "web", url: raw };
  }
  const decoded = safeDecode(raw);
  if (isLocalPath(decoded)) return { type: "file", path: decoded };
  if (/^(?:mailto|tel):/i.test(raw)) return { type: "web", url: raw };
  return { type: "none" };
}

/** A remote URL whose extension says it is a file we can view (not an HTML page). */
function isFileUrl(url: string) {
  const kind = kindOf(url);
  return kind !== "html" && (kind !== "other" || isDeliverableExt(extensionOf(url)));
}

export function attachmentForPath(path: string, origin: AttachmentOrigin): Attachment {
  return { key: `path:${path}`, path, name: fileNameOf(path), kind: kindOf(path), ext: extensionOf(path), origin };
}

export function attachmentForUrl(url: string, origin: AttachmentOrigin): Attachment {
  const gatewayPath = gatewayPathFromUrl(url);
  if (gatewayPath) return attachmentForPath(gatewayPath, origin);
  return { key: `url:${url}`, url, name: fileNameOf(url), kind: kindOf(url), ext: extensionOf(url), origin };
}

function mediaAttachment(value: string): Attachment | null {
  const clean = filePathFromUri(unquote(value));
  if (/^https?:\/\//i.test(clean)) return attachmentForUrl(clean, "media");
  return isLocalPath(clean) ? attachmentForPath(clean, "media") : null;
}

/** Remove `MEDIA:` directives from prose, collecting their attachments. */
function stripMedia(prose: string, found: Attachment[]) {
  if (!/MEDIA:/i.test(prose) && !prose.includes("[[")) return prose;
  const collect = (value: string) => {
    const attachment = mediaAttachment(value);
    if (attachment) found.push(attachment);
    return attachment;
  };
  return prose
    .replace(MEDIA_LINE_RE, (match, lead: string, value: string) => (collect(value) ? lead : match))
    .replace(MEDIA_TAG_RE, (match, value: string) => (collect(value) ? "" : match))
    .replace(MARKERS_RE, "");
}

/** Extract attachments and preview links from assistant markdown. Pure and cheap enough per delta. */
export function detectAttachments(text: string): Detection {
  const attachments: Attachment[] = [];
  const links: string[] = [];
  const segments = splitFences(text ?? "").map((segment) =>
    segment.code ? segment : { code: false, text: stripMedia(segment.text, attachments) },
  );
  const cleaned = segments.map((segment) => segment.text).join("");

  segments.forEach((segment) => {
    if (segment.code) return;
    let prose = segment.text;
    // Markdown links/images first; blank them so their targets are not re-detected as bare text.
    prose = prose.replace(MD_LINK_RE, (match, bang: string, _label: string, href: string) => {
      const target = resolveHref(href);
      if (!bang && target.type === "file") attachments.push(attachmentForPath(target.path, "markdown-link"));
      if (!bang && target.type === "remote-file") attachments.push(attachmentForUrl(target.url, "markdown-link"));
      if (!bang && target.type === "web") links.push(target.url);
      return " ".repeat(match.length);
    });
    prose = prose.replace(URL_RE, (match) => {
      const url = trimUrl(match);
      const target = resolveHref(url);
      if (target.type === "file") attachments.push(attachmentForPath(target.path, "url"));
      else if (target.type === "remote-file") attachments.push(attachmentForUrl(target.url, "url"));
      else if (target.type === "web") links.push(target.url);
      return " ".repeat(match.length);
    });
    for (const match of prose.matchAll(BARE_PATH_RE)) {
      if (isDeliverableExt(match[3].toLowerCase())) attachments.push(attachmentForPath(match[2], "bare-path"));
    }
  });

  return {
    text: cleaned.replace(/\n{3,}/g, "\n\n").trim(),
    attachments: dedupe(attachments).slice(0, MAX_ATTACHMENTS),
    links: [...new Set(links)],
  };
}

function dedupe(items: Attachment[]) {
  const seen = new Set<string>();
  return items.filter((item) => (seen.has(item.key) ? false : (seen.add(item.key), true)));
}

const TOOL_PATH_KEY_RE =
  /^(?:host_image|image|agent_visible_image|screenshot_path|file_path|local_path|output_(?:file|path)|saved_to|media_tag|path|(?:artifact|generated|result)_(?:file|image|path)|(?:audio|image|video)_(?:file|path))$/i;
const SCREENSHOT_LINE_RE = /Screenshot path:\s*([^\r\n<>]+)/gi;

/** Files named by a tool result (`tool.complete` result): JSON path fields, MEDIA tags, screenshot lines. */
export function detectToolFiles(result: unknown): Attachment[] {
  const found: Attachment[] = [];
  const visitString = (value: string) => {
    stripMedia(value, found);
    for (const match of value.matchAll(SCREENSHOT_LINE_RE)) {
      const path = match[1].trim();
      if (isLocalPath(path)) found.push(attachmentForPath(path, "tool"));
    }
  };
  const visit = (value: unknown, key: string, depth: number) => {
    if (depth > 5 || value == null) return;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (depth === 0 && /^[[{]/.test(trimmed)) {
        try {
          visit(JSON.parse(trimmed), key, depth + 1);
          return;
        } catch {
          // not JSON — scan as text
        }
      }
      if (TOOL_PATH_KEY_RE.test(key) && isLocalPath(trimmed) && isDeliverableExt(extensionOf(trimmed)))
        found.push(attachmentForPath(filePathFromUri(trimmed), "tool"));
      else visitString(value);
      return;
    }
    if (Array.isArray(value)) value.forEach((item) => visit(item, key, depth + 1));
    else if (typeof value === "object")
      Object.entries(value as Record<string, unknown>).forEach(([childKey, child]) => visit(child, childKey, depth + 1));
  };
  visit(result, "", 0);
  return dedupe(found).map((item) => ({ ...item, origin: "tool" as const })).slice(0, MAX_ATTACHMENTS);
}
