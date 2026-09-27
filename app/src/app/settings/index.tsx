import React, { useState } from "react";
import { Alert, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import Constants from "expo-constants";
import { Href, router } from "expo-router";
import { useGateway } from "@/lib/store/GatewayProvider";
import { haptic, Icon, IconName, ScreenHeader, SectionLabel } from "@/ui/primitives";
import { makeStyles, radius, space, type ThemePreference, useTheme } from "@/ui/theme";
import { ConnectionCard, hostOf } from "@/features/settings/ConnectionCard";
import { GroupCard, SettingsRow } from "@/features/settings/ui";
import { lockAvailable, setLockEnabled, useAppLock } from "@/lib/store/appLock";
import { usePush } from "@/features/push/usePush";

function PushRow() {
  const { colors } = useTheme();
  const push = usePush();
  return (
    <SettingsRow
      icon="notifications-outline"
      tint={colors.warn}
      title="Notifications"
      subtitle="Bot replies, approvals, finished automations and board reviews, via the relay on your Mac"
      right={
        <Switch
          value={push.enabled}
          disabled={push.busy}
          onValueChange={(on) => void (on ? push.enable() : push.disable())}
          trackColor={{ true: colors.accent, false: colors.raised }}
        />
      }
    />
  );
}

function LockRow() {
  const { colors } = useTheme();
  const { enabled } = useAppLock();
  const toggle = async (on: boolean) => {
    if (on && !(await lockAvailable())) {
      Alert.alert("Set up Face ID first", "Add Face ID, Touch ID or a passcode in your phone's Settings, then try again.");
      return;
    }
    await setLockEnabled(on);
  };
  return (
    <SettingsRow
      icon="lock-closed-outline"
      tint={colors.textSoft}
      title="Require Face ID"
      subtitle="Lock Hermes when you open it or return after 30 seconds"
      right={<Switch value={enabled} onValueChange={(on) => void toggle(on)} trackColor={{ true: colors.accent, false: colors.raised }} />}
    />
  );
}

const go = (path: string) => router.push(path as Href);

const APPEARANCE_OPTIONS: { value: ThemePreference; label: string; icon: IconName }[] = [
  { value: "light", label: "Light", icon: "sunny-outline" },
  { value: "dark", label: "Dark", icon: "moon-outline" },
  { value: "system", label: "System", icon: "phone-portrait-outline" },
];

function AppearanceCard() {
  const styles = useStyles();
  const { colors, preference, setPreference } = useTheme();
  return (
    <View style={styles.appearanceCard}>
      <View style={styles.segments} accessibilityRole="radiogroup" accessibilityLabel="Appearance">
        {APPEARANCE_OPTIONS.map((option) => {
          const selected = preference === option.value;
          const fg = selected ? colors.primaryInk : colors.textSoft;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ selected }}
              onPress={() => {
                if (selected) return;
                haptic.tap();
                setPreference(option.value);
              }}
              style={({ pressed }) => [
                styles.segment,
                { backgroundColor: selected ? colors.primary : colors.raised },
                pressed && !selected && { opacity: 0.7 },
              ]}
            >
              <Icon name={option.icon} size={16} color={fg} />
              <Text style={[styles.segmentText, { color: fg }]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.caption}>Light is the default. System follows your phone&apos;s setting.</Text>
    </View>
  );
}

export default function SettingsScreen() {
  const { config, disconnect, profiles } = useGateway();
  const styles = useStyles();
  const { colors, type } = useTheme();
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = () => {
    setRefreshing(true);
    setRefreshKey((k) => k + 1);
    // The card owns its own spinner; this only acknowledges the gesture.
    setTimeout(() => setRefreshing(false), 600);
  };

  const confirmDisconnect = () => {
    haptic.warn();
    Alert.alert(
      "Disconnect from gateway?",
      `You'll need the session token to reconnect to ${hostOf(config?.url)}.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: async () => {
            await disconnect();
            router.replace("/connect" as Href);
          },
        },
      ],
    );
  };

  const version = Constants.expoConfig?.version ?? "dev";
  const botCount = profiles.length;

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Settings" onBack={() => router.back()} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />}
      >
        <SectionLabel>CONNECTION</SectionLabel>
        <ConnectionCard refreshKey={refreshKey} />

        {Platform.OS !== "web" ? (
          <>
            <SectionLabel>NOTIFICATIONS & PRIVACY</SectionLabel>
            <GroupCard>
              <PushRow />
              <LockRow />
            </GroupCard>
          </>
        ) : null}

        <SectionLabel>APPEARANCE</SectionLabel>
        <AppearanceCard />

        <SectionLabel>AGENTS</SectionLabel>
        <GroupCard>
          <SettingsRow
            icon="people-outline"
            tint={colors.botHues[1]}
            title="Bots"
            subtitle={botCount ? `${botCount} profiles · models and personalities` : "Profiles, models and personalities"}
            onPress={() => go("/bots")}
          />
        </GroupCard>

        <SectionLabel>CAPABILITIES</SectionLabel>
        <GroupCard>
          <SettingsRow
            icon="sparkles-outline"
            tint={colors.accentText}
            title="Skills"
            subtitle="Turn abilities on or off for each bot"
            onPress={() => go("/settings/skills")}
          />
          <SettingsRow
            icon="alarm-outline"
            tint={colors.success}
            title="Automations"
            subtitle="Scheduled jobs your bots run on their own"
            onPress={() => go("/settings/automations")}
          />
          <SettingsRow
            icon="key-outline"
            tint={colors.success}
            title="Logins"
            subtitle="Passwords bots can use without seeing them"
            onPress={() => go("/settings/vault")}
          />
          <SettingsRow
            icon="stats-chart-outline"
            tint={colors.botHues[2]}
            title="Usage"
            subtitle="Tokens and cost by bot"
            onPress={() => go("/settings/usage")}
          />
        </GroupCard>

        <View style={{ height: space.xl }} />
        <GroupCard>
          <SettingsRow
            icon="log-out-outline"
            title="Disconnect"
            subtitle="Forget this gateway on this device"
            destructive
            onPress={confirmDisconnect}
          />
        </GroupCard>

        <View style={styles.about} accessible accessibilityLabel={`Hermes Mobile version ${version}`}>
          <Text style={styles.aboutTitle}>Hermes Mobile</Text>
          <Text style={type.small}>Version {version}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors, type) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingBottom: space.xxl * 2 },
  about: { alignItems: "center", gap: 2, marginTop: space.xxl },
  aboutTitle: { ...type.caption, color: colors.muted },
  appearanceCard: {
    marginHorizontal: space.lg,
    padding: space.md,
    gap: space.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  segments: { flexDirection: "row", gap: space.xs, padding: space.xs, borderRadius: radius.md, backgroundColor: colors.raised },
  segment: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 40,
    borderRadius: radius.sm,
  },
  segmentText: { fontSize: 14, fontWeight: "600" },
  caption: { ...type.small, paddingHorizontal: space.xs },
}));
