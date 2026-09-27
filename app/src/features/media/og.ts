/** Open Graph / meta-tag extraction for link previews. Pure (regex-based; no DOM parser on RN). */

export type LinkMeta = {
  url: string;
  domain: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === "#") {
      const point = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(point) && point > 0 && point < 0x110000 ? String.fromCodePoint(point) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function attr(tag: string, name: string) {
  const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return match ? (match[2] ?? match[3] ?? match[4] ?? "") : undefined;
}

function clean(value: string | undefined, max: number) {
  if (!value) return undefined;
  const text = decodeEntities(value).replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Parse the `<head>` of an HTML page for OG/Twitter/standard metadata. */
export function parseOpenGraph(html: string, pageUrl: string): LinkMeta {
  const head = html.slice(0, 300_000);
  const meta: Record<string, string> = {};
  for (const match of head.matchAll(/<meta\b[^>]*>/gi)) {
    const key = (attr(match[0], "property") ?? attr(match[0], "name") ?? "").toLowerCase();
    const content = attr(match[0], "content");
    if (key && content !== undefined && !(key in meta)) meta[key] = content;
  }
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1];
  const rawImage = meta["og:image:secure_url"] ?? meta["og:image"] ?? meta["og:image:url"] ?? meta["twitter:image"] ?? meta["twitter:image:src"];
  let image: string | undefined;
  if (rawImage) {
    try {
      const resolved = new URL(decodeEntities(rawImage.trim()), pageUrl).toString();
      image = /^https?:\/\//i.test(resolved) ? resolved : undefined;
    } catch {
      image = undefined;
    }
  }
  return {
    url: pageUrl,
    domain: domainOf(pageUrl),
    title: clean(meta["og:title"] ?? meta["twitter:title"] ?? titleTag, 140),
    description: clean(meta["og:description"] ?? meta["twitter:description"] ?? meta.description, 240),
    image,
    siteName: clean(meta["og:site_name"] ?? meta["application-name"], 60),
  };
}
