import React, { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import type { ServerRequest } from "@/lib/gateway/types";
import { Button, Icon, IconButton } from "@/ui/primitives";
import { makeStyles, radius, space, useTheme } from "@/ui/theme";
import { siteLabel } from "@/features/vault/vaultFormat";
import { RequestFrame } from "./RequestFrame";

/** The JSON answer Hermes expects for `vault.save_login` (it infers email / phone / username itself). */
export function loginAnswer(identifier: string, password: string) {
  return JSON.stringify({ identifier: identifier.trim(), password });
}

/**
 * "Login needed": a bot reached a login page it has no saved login for (`vault.save_login`). What you
 * enter is saved to the Hermes vault on your Mac and typed straight into that page; it never enters
 * the conversation, the bot's context or the logs.
 */
export function LoginRequestCard({
  request,
  botName,
  onAnswer,
  onDecline,
}: {
  request: ServerRequest;
  botName: string;
  onAnswer: (id: string, result: Record<string, unknown>) => void;
  onDecline: (id: string) => void;
}) {
  const styles = useStyles();
  const { colors, scheme } = useTheme();
  const origin = String(request.params?.origin ?? "");
  const site = String(request.params?.site ?? (origin ? siteLabel(origin) : "this site"));
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const ready = identifier.trim().length > 0 && password.length > 0;

  const submit = () => {
    if (ready) onAnswer(request.id, { value: loginAnswer(identifier, password) });
  };

  return (
    <RequestFrame icon="log-in-outline" title={`${botName} needs to sign in to ${site}`}>
      {origin ? (
        <View style={styles.site}>
          <Icon name="lock-closed" size={13} color={colors.success} />
          <Text style={styles.origin} numberOfLines={1}>
            {origin}
          </Text>
        </View>
      ) : null}
      <TextInput
        value={identifier}
        onChangeText={setIdentifier}
        placeholder="Username or email"
        placeholderTextColor={colors.faint}
        keyboardAppearance={scheme}
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="username"
        autoComplete="username"
        style={styles.input}
        accessibilityLabel={`Username or email for ${site}`}
      />
      <View style={styles.passwordRow}>
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="Password"
          placeholderTextColor={colors.faint}
          keyboardAppearance={scheme}
          secureTextEntry={!reveal}
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="password"
          autoComplete="password"
          onSubmitEditing={submit}
          style={[styles.input, styles.flex]}
          accessibilityLabel={`Password for ${site}`}
        />
        <IconButton icon={reveal ? "eye-off-outline" : "eye-outline"} label={reveal ? "Hide password" : "Show password"} onPress={() => setReveal((v) => !v)} />
      </View>
      <Text style={styles.note}>
        Saved to your Hermes vault and typed straight into {site}. {botName} never sees the password, and it only works on this site.
      </Text>
      <View style={styles.row}>
        <Button title="Not now" variant="secondary" onPress={() => onDecline(request.id)} style={styles.flex} />
        <Button title="Sign in" icon="log-in-outline" onPress={submit} disabled={!ready} style={styles.flex} />
      </View>
    </RequestFrame>
  );
}

const useStyles = makeStyles((colors) => ({
  site: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: space.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.bg,
  },
  origin: { color: colors.textSoft, fontSize: 13, flexShrink: 1 },
  input: {
    color: colors.text,
    fontSize: 15,
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    paddingHorizontal: space.md,
    paddingVertical: 12,
  },
  passwordRow: { flexDirection: "row", alignItems: "center", gap: space.xs },
  note: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  row: { flexDirection: "row", gap: space.sm },
  flex: { flex: 1 },
}));
