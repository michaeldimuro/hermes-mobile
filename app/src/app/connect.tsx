import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { errorText, useGateway } from "@/lib/store/GatewayProvider";
import { probeGateway } from "@/lib/gateway/rest";
import { decodePairing } from "@/features/pairing/pairing";
import { Button, Icon } from "@/ui/primitives";
import { makeStyles, radius, space, useTheme } from "@/ui/theme";

export default function ConnectScreen() {
  const styles = useStyles();
  const { colors, type, scheme } = useTheme();
  const { connect, config, lastUrl, authNotice } = useGateway();
  const insets = useSafeAreaInsets();
  // A pairing link from the installer (hermes://connect?d=...) fills everything in and connects.
  const params = useLocalSearchParams<{ d?: string }>();
  const pairing = useMemo(() => decodePairing(params.d), [params.d]);
  const [url, setUrl] = useState(pairing?.url ?? config?.url ?? lastUrl);
  const [prefilled, setPrefilled] = useState(lastUrl);
  // The remembered URL loads asynchronously; adopt it if the field is still untouched.
  if (lastUrl !== prefilled) {
    setPrefilled(lastUrl);
    if (!url) setUrl(lastUrl);
  }
  const [token, setToken] = useState("");
  const [username, setUsername] = useState(pairing?.username ?? (config?.auth === "password" ? config.username : ""));
  const [password, setPassword] = useState(pairing?.password ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // How this backend signs people in: detected from its public /api/status, overridable by hand.
  const [mode, setMode] = useState<"token" | "password">(pairing || config?.auth === "password" ? "password" : "token");
  const [probe, setProbe] = useState<{ url: string; note: string } | null>(null);

  useEffect(() => {
    const target = url.trim();
    if (!/^(https?:\/\/)?[\w.-]+(:\d+)?/.test(target)) return;
    let live = true;
    const timer = setTimeout(() => {
      probeGateway(target)
        .then((result) => {
          if (!live) return;
          const password = result.providers.includes("basic");
          if (result.authRequired && password) setMode("password");
          else if (!result.authRequired) setMode("token");
          setProbe({
            url: target,
            note: result.authRequired
              ? password
                ? `Hermes ${result.version ?? ""} · username & password sign-in`
                : "This backend only offers browser sign-in (OAuth), which the app doesn't support yet. Enable username and password sign-in on it."
              : `Hermes ${result.version ?? ""} · session token`,
          });
        })
        .catch(() => live && setProbe({ url: target, note: "" }));
    }, 500);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [url]);

  const submit = async () => {
    if (!url.trim()) return setError("Enter your gateway address.");
    if (mode === "token" && !token.trim()) return setError("Enter the dashboard session token.");
    if (mode === "password" && (!username.trim() || !password)) return setError("Enter your username and password.");
    setBusy(true);
    setError("");
    try {
      await connect(url, mode === "token" ? { token } : { username, password });
      router.replace("/");
    } catch (e) {
      const message = errorText(e, "");
      const network = !message || /network request failed|failed to fetch|did not respond|aborted/i.test(message);
      setError(
        network
          ? `Couldn't reach ${url.trim()}. Make sure Hermes is running and this device can reach it${
              /127\.0\.0\.1|localhost/.test(url) ? " (127.0.0.1 only works in a simulator on the same Mac)" : ""
            }.`
          : message,
      );
    } finally {
      setBusy(false);
    }
  };

  // Connect once, as soon as a pairing link arrives; if it fails the filled-in form stays for a retry.
  const paired = useRef<string | null>(null);
  useEffect(() => {
    if (!pairing || paired.current === params.d) return;
    paired.current = params.d ?? null;
    setUrl(pairing.url);
    setMode("password");
    setUsername(pairing.username);
    setPassword(pairing.password);
    setBusy(true);
    setError("");
    connect(pairing.url, { username: pairing.username, password: pairing.password })
      .then(() => router.replace("/"))
      .catch((e) => setError(errorText(e, `Couldn't reach ${pairing.url}. Make sure Hermes is running and this phone can reach it.`)))
      .finally(() => setBusy(false));
  }, [connect, pairing, params.d]);

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 64, paddingBottom: insets.bottom + space.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.logo}>
          <Text style={styles.logoText}>H</Text>
        </View>
        <Text style={[type.display, styles.center]}>Hermes</Text>
        <Text style={[type.small, styles.center, styles.tagline]}>
          Your bots, their skills and tools, live in your pocket.
        </Text>

        {authNotice ? (
          <View style={styles.notice} accessibilityRole="alert">
            <Icon name="key-outline" size={16} color={colors.warn} />
            <Text style={styles.noticeText}>{authNotice}</Text>
          </View>
        ) : null}

        <Text style={styles.label}>Gateway address</Text>
        <View style={styles.field}>
          <Icon name="globe-outline" size={18} color={colors.muted} />
          <TextInput
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="https://hermes.your-tailnet.ts.net"
            keyboardAppearance={scheme}
            placeholderTextColor={colors.faint}
            style={styles.input}
          />
        </View>
        {probe?.note && probe.url === url.trim() ? <Text style={[type.small, styles.probe]}>{probe.note}</Text> : null}
        {mode === "password" ? (
          <>
            <Text style={styles.label}>Username</Text>
            <View style={styles.field}>
              <Icon name="person-outline" size={18} color={colors.muted} />
              <TextInput
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="username"
                autoComplete="username"
                placeholder="Username"
                keyboardAppearance={scheme}
                placeholderTextColor={colors.faint}
                style={styles.input}
                returnKeyType="next"
              />
            </View>
            <Text style={styles.label}>Password</Text>
            <View style={styles.field}>
              <Icon name="lock-closed-outline" size={18} color={colors.muted} />
              <TextInput
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="password"
                autoComplete="password"
                placeholder="Password"
                keyboardAppearance={scheme}
                placeholderTextColor={colors.faint}
                style={styles.input}
                onSubmitEditing={submit}
                returnKeyType="go"
              />
            </View>
          </>
        ) : (
          <>
            <Text style={styles.label}>Session token</Text>
            <View style={styles.field}>
              <Icon name="key-outline" size={18} color={colors.muted} />
              <TextInput
                value={token}
                onChangeText={setToken}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Dashboard session token"
                keyboardAppearance={scheme}
                placeholderTextColor={colors.faint}
                style={styles.input}
                onSubmitEditing={submit}
                returnKeyType="go"
              />
            </View>
          </>
        )}
        <Pressable
          accessibilityRole="button"
          onPress={() => setMode(mode === "token" ? "password" : "token")}
          style={styles.switch}
        >
          <Text style={styles.switchText}>{mode === "token" ? "Use a username & password instead" : "Use a session token instead"}</Text>
        </Pressable>
        {error ? (
          <View style={styles.error}>
            <Icon name="alert-circle" size={16} color={colors.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}
        <Button title="Connect" onPress={submit} loading={busy} style={{ marginTop: space.xl }} />
        <Text style={[type.small, styles.hint]}>
          Use an address your phone can reach (Tailscale or a private LAN); 127.0.0.1 means the phone itself. For one
          conversation across desktop and phone, point the Hermes desktop app (Settings → Gateways → Remote gateway) at
          this same backend. Credentials are kept in the device keychain.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles((colors, type) => ({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: space.xl, maxWidth: 520, width: "100%", alignSelf: "center" },
  logo: {
    alignSelf: "center",
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.text,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: space.lg,
  },
  logoText: { color: colors.bg, fontSize: 36, fontWeight: "800" },
  center: { textAlign: "center" },
  tagline: { marginTop: space.sm, marginBottom: space.xxl },
  label: { ...type.caption, marginTop: space.lg, marginBottom: space.sm },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    paddingHorizontal: space.md,
  },
  input: { flex: 1, color: colors.text, fontSize: 16, paddingVertical: 14 },
  error: { flexDirection: "row", gap: space.sm, alignItems: "center", marginTop: space.md },
  errorText: { color: colors.danger, fontSize: 14, flex: 1 },
  hint: { marginTop: space.xl, textAlign: "center" },
  probe: { marginTop: space.sm },
  switch: { alignSelf: "flex-start", paddingVertical: space.sm, marginTop: space.xs },
  switchText: { color: colors.accentText, fontSize: 14, fontWeight: "600" },
  notice: {
    flexDirection: "row",
    gap: space.sm,
    alignItems: "flex-start",
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.warn,
    marginBottom: space.sm,
  },
  noticeText: { color: colors.textSoft, fontSize: 14, lineHeight: 20, flex: 1 },
}));
