import React from "react";
import { Pressable, Text, View } from "react-native";
import { RequestFrame } from "@/features/chat/RequestFrame";
import { Button, Icon } from "@/ui/primitives";
import { makeStyles, radius, space, useTheme } from "@/ui/theme";
import type { Handoff } from "./useChatBrowser";

/** A reply that asks you to sign in somewhere (the bot didn't use the handoff tool, but its browser is open). */
export const asksForSignIn = (text: string) =>
  /\b(log ?in|sign ?in|signed in|SSO|2FA|two[- ]factor|passkey|authenticat\w*|captcha|verification code)\b/i.test(text);

type Props = {
  botName: string;
  handoff: Handoff | null;
  /** The bot's browser is open for this chat. */
  browserOpen: boolean;
  /** The latest reply asks for a sign-in. */
  signInAsked: boolean;
  onOpen: () => void;
};

/**
 * The screen-share button in the chat. A handoff (the bot waiting on you) gets the full card; an open browser
 * after a reply that asks you to sign in gets it too; otherwise an open browser is a quiet "watch" chip.
 */
export function BrowserShareCard({ botName, handoff, browserOpen, signInAsked, onOpen }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  if (handoff || (browserOpen && signInAsked)) {
    return (
      <RequestFrame icon="desktop-outline" title={`${botName} needs you in its browser`}>
        <Text style={styles.body}>
          {handoff?.reason ||
            "Open the screen to sign in. What you type goes straight into the page, not into the chat."}
        </Text>
        <Button title="Open screen" icon="eye-outline" variant="primary" onPress={onOpen} />
        {handoff ? <Text style={styles.note}>{botName} continues when you tap Done.</Text> : null}
      </RequestFrame>
    );
  }
  if (!browserOpen) return null;
  return (
    <View style={styles.chipRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Watch ${botName}'s browser`}
        onPress={onOpen}
        style={({ pressed }) => [styles.chip, pressed && { opacity: 0.6 }]}
      >
        <Icon name="desktop-outline" size={14} color={colors.textSoft} />
        <Text style={styles.chipText}>Watch {botName}&apos;s browser</Text>
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  body: { color: colors.textSoft, fontSize: 15, lineHeight: 21 },
  note: { color: colors.faint, fontSize: 12, textAlign: "center" },
  chipRow: { flexDirection: "row", paddingHorizontal: space.md, marginBottom: space.xs },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 30,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: colors.raised,
  },
  chipText: { color: colors.textSoft, fontSize: 13, fontWeight: "500" },
}));
