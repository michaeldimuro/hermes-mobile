import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleProp, Text, TextStyle, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { haptic, Icon } from "@/ui/primitives";
import { makeStyles, radius, space, useTheme } from "@/ui/theme";

/**
 * A fenced code block from a reply: language + Copy in a slim header, code that scrolls sideways
 * instead of wrapping (commands and paths stay intact and copyable).
 */
export function CodeBlock({ code, language, textStyle }: { code: string; language?: string; textStyle?: StyleProp<TextStyle> }) {
  const styles = useStyles();
  const { colors, type } = useTheme();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = () => {
    Clipboard.setStringAsync(code)
      .then(() => {
        haptic.success();
        setCopied(true);
      })
      .catch(() => undefined);
  };

  return (
    <View style={styles.block}>
      <View style={styles.header}>
        <Text style={styles.language}>{language?.trim().split(/\s+/)[0] || "code"}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copied ? "Copied" : "Copy code"}
          onPress={copy}
          hitSlop={10}
          style={({ pressed }) => [styles.copy, pressed && { opacity: 0.6 }]}
        >
          <Icon name={copied ? "checkmark" : "copy-outline"} size={14} color={copied ? colors.success : colors.muted} />
          <Text style={[styles.copyText, copied && { color: colors.success }]}>{copied ? "Copied" : "Copy"}</Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text selectable style={[type.mono, styles.code, textStyle]}>
          {code}
        </Text>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  block: {
    marginVertical: 6,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: space.md,
    paddingRight: space.sm,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  language: { color: colors.faint, fontSize: 12, fontWeight: "500" },
  copy: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 4 },
  copyText: { color: colors.muted, fontSize: 12, fontWeight: "600" },
  scroll: { padding: space.md },
  code: { color: colors.textSoft, fontSize: 13, lineHeight: 19 },
}));
