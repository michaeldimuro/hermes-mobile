import React, { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Icon } from "@/ui/primitives";
import { makeStyles, radius, space, useTheme } from "@/ui/theme";
import type { Attachment } from "./detect";
import { formatBytes } from "./kinds";
import { kindIcon, kindLabel } from "./kindIcon";
import { openAttachment } from "./navigation";
import { useFile, useFileRequest, useRemoteSize } from "./useFile";

/**
 * Tappable file card for a bot-shared file: kind icon (or image thumbnail), name, type · size.
 * Network work (thumbnail download, size probe) waits until `deferred` is false.
 */
export const AttachmentCard = memo(function AttachmentCard({
  attachment,
  profile,
  sessionId,
  deferred,
}: {
  attachment: Attachment;
  profile?: string | null;
  sessionId?: string | null;
  deferred?: boolean;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const fileRef = attachment.path ? { path: attachment.path, profile, sessionId } : attachment.url ? { url: attachment.url } : null;
  const isImage = attachment.kind === "image";
  const image = useFile(isImage ? fileRef : null, { enabled: !deferred });
  const request = useFileRequest(fileRef);
  const probed = useRemoteSize(isImage ? null : request, !deferred);
  const size = isImage ? image.size : probed;
  const meta = [kindLabel(attachment.kind, attachment.name), formatBytes(size)].filter(Boolean).join(" · ");
  const failed = isImage && image.status === "error";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${kindLabel(attachment.kind, attachment.name)} ${attachment.name}`}
      accessibilityHint="Opens the file in the viewer"
      onPress={() => openAttachment(attachment, { profile, sessionId })}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.8 }]}
    >
      <View style={[styles.thumb, attachment.kind === "video" && styles.thumbVideo]}>
        {isImage && image.localUri ? (
          <Image source={{ uri: image.localUri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} />
        ) : (
          <Icon
            name={attachment.kind === "video" ? "play" : kindIcon(attachment.kind)}
            size={attachment.kind === "video" ? 22 : 24}
            color={attachment.kind === "video" ? "#fff" : failed ? colors.danger : colors.accentText}
          />
        )}
      </View>
      <View style={styles.text}>
        <Text style={styles.name} numberOfLines={1} ellipsizeMode="middle">
          {attachment.name}
        </Text>
        <Text style={[styles.meta, failed && { color: colors.danger }]} numberOfLines={1}>
          {failed ? image.error : meta}
        </Text>
      </View>
      <Icon name="chevron-forward" size={18} color={colors.faint} />
    </Pressable>
  );
});

const useStyles = makeStyles((colors, type) => ({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.sm,
    paddingRight: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    marginVertical: space.xs,
    maxWidth: 420,
  },
  thumb: {
    width: 48,
    height: 48,
    borderRadius: radius.sm,
    backgroundColor: colors.raised,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  thumbVideo: { backgroundColor: "#111114" },
  text: { flex: 1, gap: 2 },
  name: { ...type.heading, fontSize: 15 },
  meta: { ...type.small, fontSize: 12 },
}));
