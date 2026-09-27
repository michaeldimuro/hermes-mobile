import React from "react";
import { View } from "react-native";

/**
 * Web: react-native-webview is unsupported, so PDFs/HTML render in an iframe over the blob URL.
 * HTML is sandboxed (scripts allowed, no same-origin access to the app).
 */
export function DocumentViewer({
  uri,
  name,
  kind,
}: {
  uri: string;
  name: string;
  kind: "pdf" | "html";
  size: number | null;
  onOpenExternally: () => void;
}) {
  return (
    <View style={{ flex: 1 }}>
      <iframe
        src={uri}
        title={name}
        sandbox={kind === "html" ? "allow-scripts allow-popups" : undefined}
        style={{ border: 0, width: "100%", height: "100%", flex: 1 }}
      />
    </View>
  );
}
