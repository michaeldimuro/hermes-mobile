import React, { useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { errorText, useGateway } from "@/lib/store/GatewayProvider";
import { EditorCard, EditorField, ValueRow } from "@/features/bots/EditorBits";
import { botNameError, botTitle, go, normalizeBotName, sortBots } from "@/features/bots/format";
import { ModelSheet, type ModelPick } from "@/features/bots/ModelSheet";
import { BotAvatar, Button, Chip, haptic, ScreenHeader } from "@/ui/primitives";
import { makeStyles, space, useTheme } from "@/ui/theme";

type CreateResult = { ok?: boolean; name: string; model_set?: boolean; soul_written?: boolean };

export default function NewBot() {
  const { colors, type } = useTheme();
  const styles = useStyles();
  const { call, profiles, refreshProfiles, showToast, connection } = useGateway();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState("");
  const [touched, setTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [soul, setSoul] = useState("");
  const [cloneFrom, setCloneFrom] = useState<string | null>(null);
  const [model, setModel] = useState<ModelPick | null>(null);
  const [modelOpen, setModelOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const existing = useMemo(() => profiles.map((p) => p.name), [profiles]);
  const bots = useMemo(() => sortBots(profiles), [profiles]);
  const nameError = botNameError(name, existing);
  const showError = touched && name.length > 0 ? nameError : null;
  const canCreate = !nameError && connection === "open" && !creating;

  const create = async () => {
    setTouched(true);
    if (nameError) {
      haptic.warn();
      return;
    }
    setCreating(true);
    // Declared params only. mirror_credentials copies the launch profile's provider keys/auth (not
    // channel bot tokens) so the new bot can talk to a model immediately; without a model pick the
    // server also inherits the launch model.
    const params: Record<string, unknown> = { name, mirror_credentials: true };
    if (description.trim()) params.description = description.trim();
    if (soul.trim()) params.soul = soul;
    if (cloneFrom) params.clone_from = cloneFrom;
    if (model) {
      params.model = model.model;
      params.provider = model.provider;
    }
    try {
      const result = await call<CreateResult>("profiles.create", params, 60_000);
      await refreshProfiles();
      haptic.success();
      if (model && result.model_set === false) showToast(`Created ${botTitle(name)}, but its model couldn't be set`, "warn");
      else showToast(`${botTitle(name)} is ready`, "success");
      go.replace(`/bots/${encodeURIComponent(result.name || name)}`);
    } catch (err) {
      haptic.warn();
      showToast(errorText(err, "Could not create bot"), "error");
      setCreating(false);
    }
  };

  const modelHint = cloneFrom ? `Keeps ${botTitle(cloneFrom)}'s model` : "Inherits your default bot's model";

  return (
    <View style={styles.screen}>
      <ScreenHeader title="New bot" subtitle="A specialised Hermes agent" onBack={() => router.back()} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xxl }]}
        >
          <View style={styles.preview}>
            <BotAvatar name={name || "?"} size={64} ring />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={type.title}>
                {name ? botTitle(name) : "Untitled bot"}
              </Text>
              <Text numberOfLines={2} style={type.small}>
                {description.trim() || "Describe its role below"}
              </Text>
            </View>
          </View>

          <EditorCard icon="at" title="Name" hint="The bot's id: lowercase letters, numbers, - or _.">
            <EditorField
              value={name}
              onChangeText={(text) => setName(normalizeBotName(text))}
              onBlur={() => setTouched(true)}
              placeholder="e.g. reviewer"
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              maxLength={64}
              returnKeyType="next"
              accessibilityLabel="Bot name"
              style={showError ? { borderColor: colors.danger } : undefined}
            />
            {showError ? <Text style={styles.error}>{showError}</Text> : null}
          </EditorCard>

          <EditorCard icon="briefcase-outline" title="Role" hint="One line on what this bot is for.">
            <EditorField
              value={description}
              onChangeText={setDescription}
              placeholder="e.g. Reviews pull requests for security issues"
              multiline
              minHeight={64}
              accessibilityLabel="Role description"
            />
          </EditorCard>

          <EditorCard icon="document-text-outline" title="Persona & instructions" hint="Optional. Who the bot is and how it should work.">
            <EditorField
              value={soul}
              onChangeText={setSoul}
              placeholder="You are a meticulous reviewer who…"
              multiline
              minHeight={140}
              autoCorrect={false}
              accessibilityLabel="Persona and instructions"
            />
          </EditorCard>

          <EditorCard icon="copy-outline" title="Start from" hint="Clone an existing bot's config and skills, or start fresh with the bundled skills.">
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              <Chip label="Fresh" icon="leaf-outline" active={cloneFrom === null} onPress={() => setCloneFrom(null)} />
              {bots.map((bot) => (
                <Chip
                  key={bot.name}
                  label={botTitle(bot)}
                  active={cloneFrom === bot.name}
                  onPress={() => setCloneFrom(cloneFrom === bot.name ? null : bot.name)}
                />
              ))}
            </ScrollView>
          </EditorCard>

          <EditorCard icon="hardware-chip-outline" title="Model" hint="Optional. You can change it any time.">
            <ValueRow
              label={model ? model.provider.toUpperCase() : "DEFAULT"}
              value={model ? model.model : modelHint}
              onPress={() => setModelOpen(true)}
            />
          </EditorCard>

          <Button
            title={creating ? "Creating…" : "Create bot"}
            icon="sparkles"
            variant="accent"
            loading={creating}
            disabled={!canCreate}
            onPress={create}
            style={{ marginTop: space.sm }}
          />
          {connection !== "open" ? <Text style={[type.small, styles.center]}>Connect to Hermes to create bots.</Text> : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <ModelSheet visible={modelOpen} onClose={() => setModelOpen(false)} value={model} onSelect={setModel} allowInherit />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: space.lg, gap: space.lg },
  preview: { flexDirection: "row", alignItems: "center", gap: space.lg, paddingVertical: space.md },
  error: { fontSize: 13, color: colors.danger, marginTop: -space.xs },
  chips: { gap: space.sm, paddingRight: space.sm },
  center: { textAlign: "center" },
}));
