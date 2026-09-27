import React, { memo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import { Icon } from "@/ui/primitives";
import { makeStyles, radius, space, useTheme } from "@/ui/theme";
import { fileNameOf } from "./kinds";
import { openViewer } from "./navigation";
import { useFile } from "./useFile";

const MAX_HEIGHT = 320;

/**
 * Auto-sized image preview for a gateway path or remote URL; tap opens the zoomable viewer.
 * `deferred` (while the reply streams) skips the download and shows a placeholder.
 */
export const InlineImage = memo(function InlineImage({
  path,
  url,
  alt,
  profile,
  sessionId,
  deferred,
}: {
  path?: string;
  url?: string;
  alt?: string;
  profile?: string | null;
  sessionId?: string | null;
  deferred?: boolean;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const fileRef = path ? { path, profile, sessionId } : url ? { url } : null;
  const file = useFile(fileRef, { enabled: !deferred });
  const [aspect, setAspect] = useState<number | null>(null);
  const name = alt || fileNameOf(path ?? url ?? "") || "Image";
  const open = () => openViewer({ path, url, kind: "image", name: fileNameOf(path ?? url ?? ""), profile, sessionId });

  return (
    <Pressable
      accessibilityRole="imagebutton"
      accessibilityLabel={`Open image ${name}`}
      onPress={open}
      style={({ pressed }) => [styles.frame, pressed && { opacity: 0.85 }]}
    >
      {file.localUri ? (
        <Image
          source={{ uri: file.localUri }}
          style={[styles.image, { aspectRatio: aspect ?? 4 / 3 }]}
          contentFit="cover"
          transition={150}
          accessibilityIgnoresInvertColors
          onLoad={(event) => {
            const { width, height } = event.source;
            if (width > 0 && height > 0) setAspect(Math.max(0.5, Math.min(2.4, width / height)));
          }}
        />
      ) : (
        <View style={styles.placeholder}>
          {file.status === "error" ? (
            <>
              <Icon name="image-outline" size={26} color={colors.danger} />
              <Text style={styles.error} numberOfLines={2}>
                {file.error}
              </Text>
            </>
          ) : file.status === "loading" ? (
            <ActivityIndicator color={colors.muted} />
          ) : (
            <Icon name="image-outline" size={26} color={colors.faint} />
          )}
          <Text style={styles.caption} numberOfLines={1}>
            {name}
          </Text>
        </View>
      )}
    </Pressable>
  );
});

const useStyles = makeStyles((colors, type) => ({
  frame: {
    alignSelf: "stretch",
    maxWidth: 420,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: colors.raised,
    marginVertical: space.xs,
  },
  image: { width: "100%", maxHeight: MAX_HEIGHT },
  placeholder: { height: 160, alignItems: "center", justifyContent: "center", gap: space.sm, padding: space.md },
  caption: { ...type.small, maxWidth: "90%" },
  error: { color: colors.danger, fontSize: 12, textAlign: "center" },
}));
