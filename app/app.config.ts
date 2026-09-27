import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * app.json holds the official build's identity. To build your own copy, set:
 *   HERMES_MOBILE_BUNDLE_ID       e.g. com.yourname.hermesmobile (iOS bundle id, Android package, app
 *                                 group and extension ids all derive from it)
 *   HERMES_MOBILE_EXPO_OWNER      your Expo account
 *   HERMES_MOBILE_EAS_PROJECT_ID  from `npx eas-cli@latest init`
 */
const OFFICIAL_BUNDLE_ID = "com.mndimuro.hermesmobile";

export default ({ config }: ConfigContext): ExpoConfig => {
  const bundleId = process.env.HERMES_MOBILE_BUNDLE_ID?.trim();
  const owner = process.env.HERMES_MOBILE_EXPO_OWNER?.trim();
  const projectId = process.env.HERMES_MOBILE_EAS_PROJECT_ID?.trim();

  let out = config as ExpoConfig;
  if (bundleId && bundleId !== OFFICIAL_BUNDLE_ID) {
    // Every identifier (bundle, package, app group, extension targets) is derived from the base id.
    out = JSON.parse(JSON.stringify(out).split(OFFICIAL_BUNDLE_ID).join(bundleId));
  }
  if (owner) out = { ...out, owner };
  if (projectId || owner || bundleId) {
    // Someone else's build must not point at the official EAS project.
    const eas = { ...(out.extra?.eas ?? {}), projectId: projectId || undefined };
    out = { ...out, extra: { ...out.extra, eas } };
  }
  return out;
};
