import React, { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { Button, IconButton, Sheet } from "@/ui/primitives";
import { makeStyles, radius, space, useTheme } from "@/ui/theme";
import { loginParams, type NewLogin } from "./vaultFormat";

const EMPTY: NewLogin = { label: "", website: "", identifier: "", password: "", otpSecret: "" };

/** Save a login to the Hermes vault. It goes straight into the encrypted store on your Mac. */
export function AddLoginSheet({
  visible,
  onClose,
  onSave,
}: {
  visible: boolean;
  onClose: () => void;
  onSave: (params: Record<string, unknown>) => Promise<boolean>;
}) {
  const styles = useStyles();
  const { colors, scheme } = useTheme();
  const [form, setForm] = useState<NewLogin>(EMPTY);
  const [reveal, setReveal] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof NewLogin) => (value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setProblem(null);
  };

  const close = () => {
    setForm(EMPTY);
    setReveal(false);
    setProblem(null);
    onClose();
  };

  const save = async () => {
    const result = loginParams(form);
    if ("error" in result) return setProblem(result.error);
    setBusy(true);
    const ok = await onSave(result.params);
    setBusy(false);
    if (ok) close();
  };

  const field = { placeholderTextColor: colors.faint, keyboardAppearance: scheme, style: styles.input } as const;
  return (
    <Sheet visible={visible} onClose={close} title="Add login">
      <View style={styles.form}>
        <TextInput {...field} value={form.website} onChangeText={set("website")} placeholder="Website, e.g. github.com" autoCapitalize="none" autoCorrect={false} keyboardType="url" textContentType="URL" accessibilityLabel="Website" />
        <TextInput {...field} value={form.identifier} onChangeText={set("identifier")} placeholder="Username or email" autoCapitalize="none" autoCorrect={false} textContentType="username" autoComplete="username" accessibilityLabel="Username or email" />
        <View style={styles.passwordRow}>
          <TextInput
            {...field}
            style={[styles.input, styles.flex]}
            value={form.password}
            onChangeText={set("password")}
            placeholder="Password"
            secureTextEntry={!reveal}
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="password"
            autoComplete="password"
            accessibilityLabel="Password"
          />
          <IconButton icon={reveal ? "eye-off-outline" : "eye-outline"} label={reveal ? "Hide password" : "Show password"} onPress={() => setReveal((v) => !v)} />
        </View>
        <TextInput {...field} value={form.label} onChangeText={set("label")} placeholder="Name (optional)" accessibilityLabel="Name" />
        <TextInput {...field} value={form.otpSecret} onChangeText={set("otpSecret")} placeholder="2FA setup key (optional)" autoCapitalize="characters" autoCorrect={false} secureTextEntry accessibilityLabel="Two-factor setup key" />
        <Text style={styles.note}>
          Saved in the encrypted Hermes vault on your Mac. Bots fill it into that website&apos;s login page without ever seeing the password.
        </Text>
        {problem ? <Text style={styles.problem}>{problem}</Text> : null}
        <Button title="Save login" icon="lock-closed-outline" onPress={() => void save()} loading={busy} disabled={busy} />
      </View>
    </Sheet>
  );
}

const useStyles = makeStyles((colors) => ({
  form: { gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.lg },
  input: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 3,
    color: colors.text,
    fontSize: 16,
  },
  passwordRow: { flexDirection: "row", alignItems: "center", gap: space.xs },
  flex: { flex: 1 },
  note: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  problem: { color: colors.danger, fontSize: 13 },
}));
