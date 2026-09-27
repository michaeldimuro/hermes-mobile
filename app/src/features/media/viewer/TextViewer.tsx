import React, { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import Markdown from "react-native-markdown-display";
import { makeStyles, space, useTheme } from "@/ui/theme";
import { readLocalText } from "../cache";
import { extensionOf } from "../kinds";
import { markdownParser } from "../markdown";
import { openWebLink } from "../navigation";
import { useDocumentMarkdownStyle } from "./markdownStyle";

const MAX_BYTES = 512 * 1024;

type Loaded = { uri: string; text: string; truncated: boolean } | { uri: string; error: string };

function prettify(text: string, name: string) {
  if (extensionOf(name) !== "json") return text;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** Markdown (rendered like chat) or plain text/code/JSON/CSV in a scrollable monospace view. */
export function TextViewer({ uri, name, markdown }: { uri: string; name: string; markdown: boolean }) {
  const styles = useStyles();
  const markdownStyle = useDocumentMarkdownStyle();
  const { colors } = useTheme();
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    let alive = true;
    readLocalText(uri, MAX_BYTES).then(
      (result) => alive && setLoaded({ uri, ...result }),
      (error: unknown) => alive && setLoaded({ uri, error: error instanceof Error ? error.message : "Could not read the file." }),
    );
    return () => {
      alive = false;
    };
  }, [uri]);

  const current = loaded?.uri === uri ? loaded : null;
  if (!current)
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.muted} />
      </View>
    );
  if ("error" in current)
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{current.error}</Text>
      </View>
    );

  const note = current.truncated ? <Text style={styles.note}>Showing the first 512 KB. Share the file to see all of it.</Text> : null;
  if (markdown)
    return (
      <ScrollView contentContainerStyle={styles.page}>
        <Markdown
          style={markdownStyle}
          mergeStyle
          markdownit={markdownParser}
          onLinkPress={(url) => {
            openWebLink(url);
            return false;
          }}
        >
          {current.text}
        </Markdown>
        {note}
      </ScrollView>
    );
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <ScrollView horizontal contentContainerStyle={styles.codeWrap}>
        <Text selectable style={styles.code}>
          {prettify(current.text, name)}
        </Text>
      </ScrollView>
      {note}
    </ScrollView>
  );
}

const useStyles = makeStyles((colors, type) => ({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl },
  error: { color: colors.danger, textAlign: "center" },
  page: { padding: space.lg, paddingBottom: space.xxl * 2 },
  codeWrap: { paddingRight: space.lg },
  code: { ...type.mono, color: colors.text, lineHeight: 19 },
  note: { ...type.small, marginTop: space.lg, textAlign: "center" },
}));
