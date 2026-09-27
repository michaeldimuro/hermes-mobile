import React, { useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { errorText, useGateway } from "@/lib/store/GatewayProvider";
import { haptic, IconButton } from "@/ui/primitives";
import { makeStyles, space, useTheme } from "@/ui/theme";
import { fetchToLocal, shareLocal } from "../cache";
import { formatBytes, type MediaKind } from "../kinds";
import { kindLabel } from "../kindIcon";
import type { FileRef } from "../source";
import { useFile, useFileRequest, useStreamSource } from "../useFile";
import { DocumentViewer } from "./DocumentViewer";
import { FileInfo } from "./FileInfo";
import { ImageViewer } from "./ImageViewer";
import { AudioPlayer, VideoPlayer } from "./MediaPlayers";
import { TextViewer } from "./TextViewer";

/** Full-screen viewer body + header for one file. Route: src/app/viewer.tsx. */
export function FileViewer({ fileRef, kind, name }: { fileRef: FileRef | null; kind: MediaKind; name: string }) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { showToast } = useGateway();
  const request = useFileRequest(fileRef);
  const stream = useStreamSource(kind === "video" || kind === "audio" ? fileRef : null);
  const file = useFile(fileRef, { enabled: !stream });
  const [sharing, setSharing] = useState(false);
  const title = name || file.name || "File";
  const dark = kind === "video" || kind === "image";

  const share = () => {
    if (!request || sharing) return;
    setSharing(true);
    const local = file.localUri ? Promise.resolve({ uri: file.localUri }) : fetchToLocal(request);
    local
      .then((result) => shareLocal(result.uri, file.mime, title))
      .then(() => haptic.success())
      .catch((error: unknown) => showToast(errorText(error, "Could not share the file."), "error"))
      .finally(() => setSharing(false));
  };
  const close = () => (router.canGoBack() ? router.back() : router.replace("/"));

  const body = () => {
    if (stream && kind === "video") return <VideoPlayer source={stream} label={title} />;
    if (stream && kind === "audio") return <AudioPlayer source={stream} label={title} />;
    if (file.status !== "ready" || !file.localUri)
      return (
        <FileInfo
          name={title}
          kind={kind}
          loading={file.status === "loading"}
          error={file.error}
          onRetry={file.retry}
        />
      );
    const uri = file.localUri;
    switch (kind) {
      case "image":
        return <ImageViewer uri={uri} label={title} />;
      case "video":
        return <VideoPlayer source={{ uri }} label={title} />;
      case "audio":
        return <AudioPlayer source={{ uri }} label={title} />;
      case "markdown":
      case "text":
        return <TextViewer uri={uri} name={title} markdown={kind === "markdown"} />;
      case "pdf":
      case "html":
        return <DocumentViewer uri={uri} name={title} kind={kind} size={file.size} onOpenExternally={share} />;
      default:
        return <FileInfo name={title} kind={kind} size={file.size} onOpen={share} />;
    }
  };

  const meta = [kindLabel(kind, title), formatBytes(file.size)].filter(Boolean).join(" · ");
  return (
    <View style={[styles.screen, dark && { backgroundColor: colors.scheme === "dark" ? colors.bg : "#000" }]}>
      <View style={[styles.header, { paddingTop: insets.top + space.xs }, dark && styles.headerDark]}>
        <IconButton icon="close" label="Close viewer" size={24} color={dark ? "#fff" : colors.text} onPress={close} />
        <View style={styles.titleWrap}>
          <Text style={[styles.title, dark && styles.onDark]} numberOfLines={1} accessibilityRole="header">
            {title}
          </Text>
          <Text style={[styles.meta, dark && styles.onDarkSoft]} numberOfLines={1}>
            {meta}
          </Text>
        </View>
        {sharing ? (
          <ActivityIndicator color={dark ? "#fff" : colors.muted} style={styles.spinner} />
        ) : (
          <IconButton
            icon="share-outline"
            label="Share or open in another app"
            size={22}
            color={dark ? "#fff" : colors.text}
            disabled={!request}
            onPress={share}
          />
        )}
      </View>
      <View style={[styles.body, { paddingBottom: kind === "video" ? 0 : insets.bottom }]}>{body()}</View>
    </View>
  );
}

const useStyles = makeStyles((colors, type) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingHorizontal: space.sm,
    paddingBottom: space.sm,
    backgroundColor: colors.bg,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.border,
  },
  headerDark: { backgroundColor: "rgba(0,0,0,0.85)", borderBottomColor: "rgba(255,255,255,0.08)" },
  titleWrap: { flex: 1, alignItems: "center" },
  title: { ...type.heading, fontSize: 15 },
  meta: { ...type.small, fontSize: 12 },
  onDark: { color: "#fff" },
  onDarkSoft: { color: "rgba(255,255,255,0.6)" },
  spinner: { width: 40 },
  body: { flex: 1 },
}));
