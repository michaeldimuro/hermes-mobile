/**
 * Where the Mac-side push relay (scripts/push-relay) finds this phone: Expo push tokens kept in the
 * default profile's `ui_meta["hermes-mobile-push"]`, written with compare-and-swap like the group
 * mirror so two devices never clobber each other.
 */
export const PUSH_META_KEY = "hermes-mobile-push";
export type PushDevice = { token: string; name: string; at: number };
export type PushMeta = { devices: PushDevice[] };

type Call = <T>(method: string, params?: Record<string, unknown>, timeoutMs?: number) => Promise<T>;
type Row = { name: string; ui_meta?: Record<string, unknown> | null; ui_meta_revisions?: Record<string, number> | null };

/** Adds (or refreshes) `device`, or removes `token` when `device` is null. Pure. */
export function nextPushMeta(current: unknown, token: string, device: PushDevice | null): PushMeta {
  const devices = Array.isArray((current as PushMeta | null)?.devices) ? (current as PushMeta).devices.filter((d) => d && d.token !== token) : [];
  return { devices: device ? [...devices, device].slice(-8) : devices };
}

export async function writePushDevice(call: Call, token: string, device: PushDevice | null) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const list = await call<{ profiles?: Row[] }>("profiles.list", { include_sessions: false }, 20_000);
    const row = (list.profiles ?? []).find((p) => p.name === "default");
    if (!row) throw new Error("Hermes has no default profile.");
    const revision = Number(row.ui_meta_revisions?.[PUSH_META_KEY] || 0);
    const result = await call<{ applied?: { ui_meta?: boolean } }>(
      "profiles.configure",
      {
        name: "default",
        ui_meta: { [PUSH_META_KEY]: nextPushMeta(row.ui_meta?.[PUSH_META_KEY], token, device) },
        ui_meta_expected_revisions: { [PUSH_META_KEY]: revision },
      },
      20_000,
    );
    if (result?.applied?.ui_meta === true) return;
  }
  throw new Error("Couldn't save notification settings on Hermes.");
}
