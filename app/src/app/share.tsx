import React, { useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Href, router } from "expo-router";
import { useIncomingShare } from "expo-sharing";
import { Image } from "expo-image";
import { botTitle } from "@/features/chat/botMeta";
import { newChat } from "@/features/chat/ChatScreen";
import { BotChips } from "@/features/settings/BotChips";
import { SharedItem, stageShare } from "@/features/share/pendingShare";
import { useGateway } from "@/lib/store/GatewayProvider";
import { Button, EmptyState, Icon, ScreenHeader } from "@/ui/primitives";
import { makeStyles, radius, space, useTheme } from "@/ui/theme";

/** "Share to Hermes" from any app: pick a bot, add a note, and it opens a new chat with it attached. */
export default function ShareScreen() {
  const styles = useStyles();
  const { colors, type } = useTheme();
  const { profiles, activeBot } = useGateway();
  const { resolvedSharedPayloads, isResolving, clearSharedPayloads, error } = useIncomingShare();
  const [bot, setBot] = useState(activeBot);
  const [note, setNote] = useState("");

  const items: SharedItem[] = resolvedSharedPayloads.map((payload) => {
    const uri = "contentUri" in payload && payload.contentUri ? payload.contentUri : payload.value ?? "";
    if (payload.contentType === "image") return { kind: "image", value: uri, name: payload.originalName ?? undefined, mimeType: payload.contentMimeType };
    if (payload.contentType === "website" || payload.shareType === "url") return { kind: "url", value: payload.value ?? uri };
    if (payload.contentType === "text" || payload.shareType === "text") return { kind: "text", value: payload.value ?? "" };
    return { kind: "file", value: uri, name: payload.originalName ?? undefined, mimeType: payload.contentMimeType };
  });

  const send = () => {
    stageShare({ bot, note, items });
    clearSharedPayloads();
    newChat(bot);
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Share to Hermes" onBack={() => router.replace("/" as Href)} />
      {isResolving ? (
        <ActivityIndicator style={{ marginTop: space.xxl }} color={colors.muted} />
      ) : !items.length ? (
        <EmptyState icon="share-outline" title="Nothing to share" body={error?.message ?? "Share text, links, photos or files to Hermes from any app."} />
      ) : (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {items.map((item, index) =>
            item.kind === "image" ? (
              <Image key={index} source={{ uri: item.value }} style={styles.image} contentFit="cover" />
            ) : (
              <View key={index} style={styles.card}>
                <Icon name={item.kind === "url" ? "link-outline" : item.kind === "file" ? "document-outline" : "text-outline"} size={18} color={colors.textSoft} />
                <Text style={[type.body, styles.flex]} numberOfLines={4}>
                  {item.kind === "file" ? item.name ?? item.value.split("/").pop() : item.value}
                </Text>
              </View>
            ),
          )}
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Add a note, e.g. “summarise this”"
            placeholderTextColor={colors.faint}
            style={styles.note}
            multiline
            accessibilityLabel="Note"
          />
          <Text style={styles.label}>SEND TO</Text>
          <BotChips profiles={profiles} value={bot} onChange={setBot} inset={0} />
          <Button title={`Send to ${botTitle(profiles.find((p) => p.name === bot), bot)}`} icon="paper-plane-outline" onPress={send} style={{ marginTop: space.md }} />
        </ScrollView>
      )}
    </View>
  );
}

const useStyles = makeStyles((colors, type) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.md },
  flex: { flex: 1 },
  image: { width: "100%", height: 220, borderRadius: radius.lg, backgroundColor: colors.raised },
  card: {
    flexDirection: "row",
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  note: {
    minHeight: 60,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
    color: colors.text,
    fontSize: 16,
  },
  label: { ...type.caption },
}));
