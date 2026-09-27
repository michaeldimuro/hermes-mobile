import React, { useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Href, router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { errorText, useGateway } from "@/lib/store/GatewayProvider";
import type { ProfileRow } from "@/lib/gateway/types";
import { BotAvatar, Button, EmptyState, haptic, Icon, ScreenHeader, SectionLabel } from "@/ui/primitives";
import { botColor, makeStyles, radius, space, useTheme } from "@/ui/theme";
import { titleCase } from "@/features/groups/groupEvents";
import { MAX_GROUP_MEMBERS, MIN_GROUP_MEMBERS } from "@/features/groups/types";
import { useCreateDesktopRoom } from "@/features/rooms/engine/useGroupSend";

const botName = (p: ProfileRow) => p.display_name?.trim() || titleCase(p.name);
const botRole = (p: ProfileRow) => p.description?.trim() || (p.is_default ? "Primary Hermes agent" : "No role set");

export default function NewGroupScreen() {
  const styles = useStyles();
  const { colors, type, scheme } = useTheme();
  const { profiles, showToast, connection } = useGateway();
  // Rooms are created in Hermes desktop's group format, so they appear in the desktop app too.
  const createRoom = useCreateDesktopRoom();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  const bots = useMemo(
    () => [...profiles].sort((a, b) => (a.is_default === b.is_default ? a.name.localeCompare(b.name) : a.is_default ? -1 : 1)),
    [profiles],
  );
  const full = picked.length >= MAX_GROUP_MEMBERS;
  const enough = picked.length >= MIN_GROUP_MEMBERS;
  const suggestedName = picked.map((id) => botName(bots.find((b) => b.name === id) ?? { name: id })).join(", ");
  const roomName = name.trim() || suggestedName;
  const canCreate = enough && roomName.length > 0 && connection === "open" && !creating;

  const toggle = (id: string) => {
    if (picked.includes(id)) {
      haptic.tap();
      setPicked((list) => list.filter((x) => x !== id));
    } else if (full) {
      haptic.warn();
      showToast(`A room holds up to ${MAX_GROUP_MEMBERS} bots`, "warn");
    } else {
      haptic.tap();
      setPicked((list) => [...list, id]);
    }
  };

  const create = async () => {
    if (!canCreate) return;
    setCreating(true);
    try {
      const room = await createRoom({ name: roomName.slice(0, 64), members: picked });
      haptic.success();
      router.replace(`/room/${encodeURIComponent(room.roomId)}` as Href);
    } catch (error) {
      showToast(errorText(error, "Could not create the room"), "error");
      setCreating(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScreenHeader title="New group chat" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <SectionLabel>ROOM NAME</SectionLabel>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder={suggestedName || "e.g. Launch planning"}
          placeholderTextColor={colors.faint}
          keyboardAppearance={scheme}
          maxLength={80}
          style={styles.input}
          returnKeyType="done"
          accessibilityLabel="Room name"
        />
        <View style={styles.pickHead}>
          <Text style={type.caption}>PICK BOTS</Text>
          <Text style={[styles.counter, enough && { color: colors.text }]} accessibilityLiveRegion="polite">
            {picked.length}/{MAX_GROUP_MEMBERS} · min {MIN_GROUP_MEMBERS}
          </Text>
        </View>
        {bots.length === 0 ? (
          <EmptyState icon="sparkles-outline" title="No bots yet" body="Create at least two bots first, then bring them together here." />
        ) : (
          <View style={styles.grid}>
            {bots.map((bot) => {
              const index = picked.indexOf(bot.name);
              const selected = index >= 0;
              const tint = botColor(bot.name, colors);
              return (
                <Pressable
                  key={bot.name}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected, disabled: !selected && full }}
                  accessibilityLabel={`${botName(bot)}, ${botRole(bot)}`}
                  onPress={() => toggle(bot.name)}
                  style={({ pressed }) => [
                    styles.card,
                    selected && { borderColor: tint, backgroundColor: `${tint}14` },
                    !selected && full && styles.cardDim,
                    pressed && { transform: [{ scale: 0.98 }] },
                  ]}
                >
                  <View style={styles.cardTop}>
                    <BotAvatar name={bot.name} size={40} ring={selected} />
                    <View style={[styles.check, selected && { backgroundColor: tint, borderColor: tint }]}>
                      {selected ? <Text style={styles.checkText}>{index + 1}</Text> : null}
                    </View>
                  </View>
                  <Text style={[type.heading, { fontSize: 15 }]} numberOfLines={1}>
                    {botName(bot)}
                  </Text>
                  <Text style={[type.small, { fontSize: 12, lineHeight: 16 }]} numberOfLines={2}>
                    {botRole(bot)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, space.lg) }]}>
        {!enough && bots.length ? (
          <View style={styles.footHint}>
            <Icon name="information-circle-outline" size={15} color={colors.muted} />
            <Text style={type.small}>Pick at least {MIN_GROUP_MEMBERS} bots</Text>
          </View>
        ) : null}
        <Button title="Create room" icon="people" loading={creating} disabled={!canCreate} onPress={create} />
      </View>
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles((colors, type) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingBottom: space.xxl },
  input: {
    ...type.body,
    marginHorizontal: space.lg,
    backgroundColor: colors.raised,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  pickHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.lg,
    marginTop: space.xl,
    marginBottom: space.sm,
  },
  counter: { ...type.small, fontVariant: ["tabular-nums"] },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.md, paddingHorizontal: space.lg },
  card: {
    width: "47.5%",
    flexGrow: 1,
    gap: 4,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  cardDim: { opacity: 0.4 },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: space.sm },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  checkText: { color: colors.primaryInk, fontSize: 12, fontWeight: "800" },
  footer: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    gap: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  footHint: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
}));
