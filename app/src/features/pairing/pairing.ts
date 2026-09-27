/**
 * Pairing links from the installer: `hermes://connect?d=<payload>`, where payload is base64url (no
 * padding) of UTF-8 JSON `{"v":1,"url","username","password"}`. The installer's pairing page shows it
 * as a QR code; the phone's Camera opens the app on the connect screen, already filled in.
 */
export type Pairing = { url: string; username: string; password: string };

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** base64url → bytes. Standard base64 characters (+ /) and padding are tolerated. */
function base64UrlBytes(input: string): number[] | null {
  const clean = input.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of clean) {
    const value = ALPHABET.indexOf(ch);
    if (value < 0) return null;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return bytes;
}

/** UTF-8 bytes → string (strict: malformed sequences reject the whole payload). */
function utf8(bytes: number[]): string | null {
  let out = "";
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i];
    const extra = b < 0x80 ? 0 : b >> 5 === 0x6 ? 1 : b >> 4 === 0xe ? 2 : b >> 3 === 0x1e ? 3 : -1;
    if (extra < 0 || i + extra >= bytes.length + (extra ? 0 : 1)) return null;
    let code = extra ? b & (0x3f >> extra) : b;
    for (let k = 1; k <= extra; k++) {
      const next = bytes[i + k];
      if (next === undefined || next >> 6 !== 0x2) return null;
      code = (code << 6) | (next & 0x3f);
    }
    out += String.fromCodePoint(code);
    i += extra + 1;
  }
  return out;
}

export function decodePairing(raw: string | string[] | undefined): Pairing | null {
  const d = Array.isArray(raw) ? raw[0] : raw;
  if (!d || d.length > 4096) return null;
  const bytes = base64UrlBytes(d.trim());
  const text = bytes && utf8(bytes);
  if (!text) return null;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const { v, url, username, password } = data as Record<string, unknown>;
  if (v !== 1 || typeof url !== "string" || !/^https?:\/\/[^\s/]+/i.test(url)) return null;
  if (typeof username !== "string" || !username || typeof password !== "string" || !password) return null;
  return { url: url.replace(/\/+$/, ""), username, password };
}
