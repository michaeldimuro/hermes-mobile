/** Hermes vault shapes (`vault.*` RPCs, metadata only — secrets never come back) and input helpers. */
export type VaultItem = {
  id: string;
  kind: "login" | "payment" | "address" | string;
  label: string;
  origin?: string | null;
  created_at?: string;
  identifier?: string | null;
  identifier_type?: string | null;
  has_otp?: boolean | null;
  backend: string;
};
export type VaultSource = {
  name: string;
  display_name: string;
  enabled: boolean;
  needs_unlock: boolean;
  unlocked: boolean;
  installed: boolean;
};

/** "github.com", "https://github.com/login" → "https://github.com" (what Hermes binds a login to). */
export function toOrigin(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!url.hostname || (!url.hostname.includes(".") && url.hostname !== "localhost")) return null;
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return null;
  }
}

/** Same rule Hermes applies to a saved login: email, phone, else username. */
export function identifierType(identifier: string): "email" | "phone" | "username" {
  const value = identifier.trim();
  if (value.includes("@")) return "email";
  if (/^\+?\d[\d\s-]{5,}$/.test(value)) return "phone";
  return "username";
}

/** Default label for a site: its host without "www.". */
export const siteLabel = (origin: string) => {
  try {
    return new URL(origin).hostname.replace(/^www\./, "");
  } catch {
    return origin;
  }
};

export type NewLogin = { label: string; website: string; identifier: string; password: string; otpSecret: string };

/** Validates a login form; returns the `vault.add` params or a message for the user. */
export function loginParams(form: NewLogin): { params: Record<string, unknown> } | { error: string } {
  const origin = toOrigin(form.website);
  if (!origin) return { error: "Enter the website, e.g. github.com." };
  if (!form.identifier.trim()) return { error: "Enter the username or email." };
  if (!form.password) return { error: "Enter the password." };
  const secret: Record<string, string> = {
    identifier_type: identifierType(form.identifier),
    identifier: form.identifier.trim(),
    password: form.password,
  };
  if (form.otpSecret.trim()) secret.otp_secret = form.otpSecret.replace(/\s+/g, "");
  return { params: { kind: "login", label: form.label.trim() || siteLabel(origin), origin, secret } };
}
