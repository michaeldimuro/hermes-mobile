import { Linking } from "react-native";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import type { Attachment } from "./detect";
import type { MediaKind } from "./kinds";

export type ViewerTarget = {
  path?: string;
  url?: string;
  kind?: MediaKind;
  name?: string;
  profile?: string | null;
  sessionId?: string | null;
};

/** Push the full-screen in-app viewer (`/viewer`) for a gateway path or remote file URL. */
export function openViewer(target: ViewerTarget) {
  const params: Record<string, string> = {};
  if (target.path) params.path = target.path;
  if (target.url) params.url = target.url;
  if (target.kind) params.kind = target.kind;
  if (target.name) params.name = target.name;
  if (target.profile) params.profile = target.profile;
  if (target.sessionId) params.session = target.sessionId;
  if (!params.path && !params.url) return;
  router.push({ pathname: "/viewer", params });
}

export function openAttachment(attachment: Attachment, scope: { profile?: string | null; sessionId?: string | null }) {
  openViewer({
    path: attachment.path,
    url: attachment.url,
    kind: attachment.kind,
    name: attachment.name,
    profile: attachment.path ? scope.profile : undefined,
    sessionId: attachment.path ? scope.sessionId : undefined,
  });
}

/** Open a web page in the in-app browser (SFSafariViewController / Custom Tabs); mailto/tel go to the OS. */
export function openWebLink(url: string) {
  if (!/^https?:\/\//i.test(url)) {
    Linking.openURL(url).catch(() => undefined);
    return;
  }
  WebBrowser.openBrowserAsync(url, { dismissButtonStyle: "close", enableBarCollapsing: true }).catch(() =>
    Linking.openURL(url).catch(() => undefined),
  );
}
