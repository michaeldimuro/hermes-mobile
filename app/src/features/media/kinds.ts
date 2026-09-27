/** File-type classification shared by detection, download and the viewers. Pure (no RN imports). */

export type MediaKind = "image" | "video" | "audio" | "pdf" | "markdown" | "text" | "html" | "other";

const KIND_BY_EXT: Record<string, MediaKind> = {};
const assign = (kind: MediaKind, exts: string) => exts.split(" ").forEach((ext) => (KIND_BY_EXT[ext] = kind));
assign("image", "png jpg jpeg gif webp bmp svg heic heif tiff tif ico avif");
assign("video", "mp4 mov m4v webm mkv avi 3gp");
assign("audio", "mp3 m4a wav ogg oga opus flac aac m2a");
assign("pdf", "pdf");
assign("markdown", "md markdown mdown mkd");
assign("html", "html htm");
assign(
  "text",
  "txt log csv tsv json jsonl yaml yml toml ini conf cfg xml geojson gpx kml env sql sh zsh bash ps1 " +
    "py js mjs cjs ts tsx jsx rb go rs java kt swift c h cpp hpp cs php lua r css scss graphql diff patch",
);

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  heic: "image/heic",
  tiff: "image/tiff",
  avif: "image/avif",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  "3gp": "video/3gpp",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  flac: "audio/flac",
  pdf: "application/pdf",
  md: "text/markdown",
  markdown: "text/markdown",
  html: "text/html",
  htm: "text/html",
  txt: "text/plain",
  log: "text/plain",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  json: "application/json",
  xml: "application/xml",
  yaml: "application/yaml",
  yml: "application/yaml",
  zip: "application/zip",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

/** Extensions worth turning into an attachment card when they appear as a bare path in prose. */
const DELIVERABLE_OTHER = new Set(
  "doc docx odt rtf epub xls xlsx ods ppt pptx odp key zip tar gz tgz bz2 xz 7z rar apk ipa kmz".split(" "),
);

/** Lower-case extension of a path or URL (query/hash ignored), "" when none. */
export function extensionOf(pathOrUrl: string): string {
  const clean = pathOrUrl.split(/[?#]/, 1)[0] ?? "";
  const base = clean.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

export function kindOf(pathOrUrl: string): MediaKind {
  return KIND_BY_EXT[extensionOf(pathOrUrl)] ?? "other";
}

export function mimeOf(pathOrUrl: string): string {
  const ext = extensionOf(pathOrUrl);
  if (MIME_BY_EXT[ext]) return MIME_BY_EXT[ext];
  return KIND_BY_EXT[ext] === "text" ? "text/plain" : "application/octet-stream";
}

/** Every extension we recognise, longest first (safe for regex alternation). */
export const KNOWN_EXTS: readonly string[] = [...Object.keys(KIND_BY_EXT), ...DELIVERABLE_OTHER].sort(
  (a, b) => b.length - a.length,
);

/** True when a bare path with this extension should be surfaced as a file card. */
export function isDeliverableExt(ext: string): boolean {
  return Boolean(ext) && (ext in KIND_BY_EXT || DELIVERABLE_OTHER.has(ext));
}

export function isMediaKind(value: unknown): value is MediaKind {
  return (
    value === "image" ||
    value === "video" ||
    value === "audio" ||
    value === "pdf" ||
    value === "markdown" ||
    value === "text" ||
    value === "html" ||
    value === "other"
  );
}

/** Last path segment of a path or URL, URL-decoded when possible. */
export function fileNameOf(pathOrUrl: string): string {
  let clean = pathOrUrl;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(pathOrUrl)) {
    try {
      clean = new URL(pathOrUrl).pathname;
    } catch {
      clean = pathOrUrl;
    }
  }
  const base = clean.split(/[?#]/, 1)[0].split(/[\\/]/).filter(Boolean).pop() ?? pathOrUrl;
  try {
    return decodeURIComponent(base);
  } catch {
    return base;
  }
}

export function formatBytes(size: number | null | undefined): string {
  if (size == null || !Number.isFinite(size) || size < 0) return "";
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB"];
  let value = size / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
