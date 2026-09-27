import React from "react";
import { Platform, StyleSheet } from "react-native";
import { WebView } from "react-native-webview";
import { useTheme } from "@/ui/theme";
import { openWebLink } from "../navigation";
import { FileInfo } from "./FileInfo";

const LOCAL_SCHEMES = /^(?:file|about|data|blob):/i;

/**
 * PDF / HTML in a WebView loading the downloaded local file. Android's WebView has no PDF renderer,
 * so PDFs there fall back to "Open in…" (system PDF viewers via the share sheet).
 * Web links clicked inside an HTML report open in the in-app browser instead of replacing it.
 */
export function DocumentViewer({
  uri,
  name,
  kind,
  size,
  onOpenExternally,
}: {
  uri: string;
  name: string;
  kind: "pdf" | "html";
  size: number | null;
  onOpenExternally: () => void;
}) {
  const { colors } = useTheme();
  if (kind === "pdf" && Platform.OS === "android")
    return (
      <FileInfo
        name={name}
        kind="pdf"
        size={size}
        note="Android can't preview PDFs in-app. Open it with a PDF viewer."
        onOpen={onOpenExternally}
      />
    );
  const directory = uri.slice(0, uri.lastIndexOf("/") + 1);
  return (
    <WebView
      source={{ uri }}
      style={[styles.fill, { backgroundColor: colors.bg }]}
      originWhitelist={["*"]}
      allowFileAccess
      allowingReadAccessToURL={directory}
      allowFileAccessFromFileURLs={false}
      javaScriptEnabled={kind === "html"}
      setSupportMultipleWindows={false}
      startInLoadingState
      accessibilityLabel={name}
      onShouldStartLoadWithRequest={(request) => {
        if (LOCAL_SCHEMES.test(request.url)) return true;
        if (/^https?:/i.test(request.url) && request.isTopFrame !== false) {
          openWebLink(request.url);
          return false;
        }
        return /^https?:/i.test(request.url);
      }}
    />
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
