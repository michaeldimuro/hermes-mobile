import React, { useState } from "react";
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { AddLoginSheet } from "@/features/vault/AddLoginSheet";
import { useVault } from "@/features/vault/useVault";
import { siteLabel, type VaultItem, type VaultSource } from "@/features/vault/vaultFormat";
import { Button, EmptyState, haptic, Icon, IconButton, ScreenHeader, SectionLabel, Sheet } from "@/ui/primitives";
import { makeStyles, radius, space, useTheme } from "@/ui/theme";

const KIND_ICONS = { login: "key-outline", payment: "card-outline", address: "home-outline" } as const;

/** Saved logins bots can use, and the password managers Hermes can read from. */
export default function VaultScreen() {
  const styles = useStyles();
  const { colors, type, scheme } = useTheme();
  const vault = useVault();
  const [adding, setAdding] = useState(false);
  const [unlocking, setUnlocking] = useState<VaultSource | null>(null);
  const [master, setMaster] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const managers = vault.sources.filter((s) => s.name !== "local" && s.installed);

  const confirmRemove = (item: VaultItem) => {
    haptic.warn();
    Alert.alert(`Remove ${item.label}?`, "Bots will ask you again the next time they need this login.", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => void vault.remove(item) },
    ]);
  };

  const unlock = async () => {
    if (!unlocking || !master) return;
    const ok = await vault.unlock(unlocking.name, master);
    setMaster("");
    if (ok) setUnlocking(null);
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Logins"
        subtitle="Bots sign in without seeing your passwords"
        onBack={() => router.back()}
        right={<IconButton icon="add" label="Add login" filled onPress={() => setAdding(true)} />}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void vault.reload().finally(() => setRefreshing(false));
            }}
            tintColor={colors.muted}
          />
        }
      >
        {vault.items === null && !vault.error ? <ActivityIndicator style={{ marginTop: space.xxl }} color={colors.muted} /> : null}
        {vault.error && vault.items === null ? (
          <EmptyState icon="cloud-offline-outline" title="Couldn't load logins" body={vault.error} action={<Button title="Try again" variant="secondary" onPress={() => void vault.reload()} />} />
        ) : null}

        {vault.items?.length === 0 ? (
          <View style={styles.explainer}>
            <Icon name="shield-checkmark-outline" size={28} color={colors.accentText} />
            <Text style={type.heading}>No saved logins yet</Text>
            <Text style={styles.explainText}>
              When a bot reaches a login page it asks you here in the chat. Your answer goes into the encrypted vault on your Mac and is typed
              straight into that website. The bot never sees the password, and it only works on the site it was saved for.
            </Text>
            <Button title="Add a login" icon="add" variant="secondary" onPress={() => setAdding(true)} />
          </View>
        ) : null}

        {vault.items?.length ? (
          <>
            <SectionLabel>{`SAVED · ${vault.items.length}`}</SectionLabel>
            <View style={styles.card}>
              {vault.items.map((item, index) => (
                <View key={item.id} style={[styles.row, index > 0 && styles.divider]}>
                  <View style={styles.badge}>
                    <Icon name={KIND_ICONS[item.kind as keyof typeof KIND_ICONS] ?? "key-outline"} size={18} color={colors.textSoft} />
                  </View>
                  <View style={styles.flex}>
                    <Text style={type.heading} numberOfLines={1}>
                      {item.label}
                    </Text>
                    <Text style={type.small} numberOfLines={1}>
                      {[item.identifier, item.origin ? siteLabel(item.origin) : null, item.has_otp ? "2FA" : null].filter(Boolean).join(" · ")}
                    </Text>
                  </View>
                  {item.backend === "local" ? (
                    <IconButton icon="trash-outline" label={`Remove ${item.label}`} color={colors.muted} onPress={() => confirmRemove(item)} />
                  ) : (
                    <Text style={type.small}>{vault.sources.find((s) => s.name === item.backend)?.display_name ?? item.backend}</Text>
                  )}
                </View>
              ))}
            </View>
          </>
        ) : null}

        {managers.length ? (
          <>
            <SectionLabel>PASSWORD MANAGERS</SectionLabel>
            <View style={styles.card}>
              {managers.map((source, index) => (
                <View key={source.name} style={[styles.row, index > 0 && styles.divider]}>
                  <View style={styles.flex}>
                    <Text style={type.heading}>{source.display_name}</Text>
                    <Text style={type.small}>{!source.enabled ? "Off" : source.unlocked ? "Unlocked for this session" : "Locked"}</Text>
                  </View>
                  {source.enabled && source.needs_unlock ? (
                    source.unlocked ? (
                      <Button title="Lock" variant="ghost" onPress={() => void vault.lock(source.name)} style={styles.small} />
                    ) : (
                      <Button title="Unlock" variant="secondary" onPress={() => setUnlocking(source)} style={styles.small} />
                    )
                  ) : null}
                  <Switch
                    value={source.enabled}
                    onValueChange={(on) => void vault.setSource(source.name, on)}
                    trackColor={{ true: colors.accent, false: colors.raised }}
                    accessibilityLabel={`Use ${source.display_name}`}
                  />
                </View>
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>

      <AddLoginSheet visible={adding} onClose={() => setAdding(false)} onSave={vault.add} />
      <Sheet visible={Boolean(unlocking)} onClose={() => setUnlocking(null)} title={`Unlock ${unlocking?.display_name ?? ""}`}>
        <View style={styles.unlock}>
          <Text style={type.small}>Your master password goes to the {unlocking?.display_name} app on your Mac and isn&apos;t stored.</Text>
          <TextInput
            value={master}
            onChangeText={setMaster}
            placeholder="Master password"
            placeholderTextColor={colors.faint}
            keyboardAppearance={scheme}
            secureTextEntry
            autoFocus
            textContentType="password"
            onSubmitEditing={() => void unlock()}
            style={styles.input}
          />
          <Button title="Unlock" onPress={() => void unlock()} disabled={!master} />
        </View>
      </Sheet>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  explainer: { alignItems: "center", gap: space.sm, padding: space.xl, borderRadius: radius.lg, backgroundColor: colors.surface },
  explainText: { color: colors.textSoft, fontSize: 14, lineHeight: 20, textAlign: "center" },
  card: { borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.md, paddingVertical: space.sm + 2 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  badge: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.raised, alignItems: "center", justifyContent: "center" },
  flex: { flex: 1, minWidth: 0 },
  small: { minHeight: 34, paddingHorizontal: space.md },
  unlock: { gap: space.md, paddingHorizontal: space.lg, paddingBottom: space.lg },
  input: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 3,
    color: colors.text,
    fontSize: 16,
  },
}));
