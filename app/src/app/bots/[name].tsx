import React, { useEffect, useRef, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useGateway } from "@/lib/store/GatewayProvider";
import { McpCard, SkillsCard, ToolsetsCard } from "@/features/bots/CapabilitySections";
import { EditorCard, EditorField, SaveBar, Skeleton, ValueRow } from "@/features/bots/EditorBits";
import { botRole, botTitle, go, modelLabel } from "@/features/bots/format";
import { ModelSheet } from "@/features/bots/ModelSheet";
import { useBotEditor } from "@/features/bots/useBotEditor";
import { VoiceCard } from "@/features/bots/VoiceCard";
import { BotAvatar, Button, EmptyState, Icon, IconButton, ScreenHeader } from "@/ui/primitives";
import { botColor, makeStyles, radius, space, useTheme } from "@/ui/theme";

export default function BotDetail() {
  const { colors } = useTheme();
  const styles = useStyles();
  const params = useLocalSearchParams<{ name: string }>();
  const name = decodeURIComponent(String(params.name ?? ""));
  const { profiles, activeBot, setActiveBot } = useGateway();
  const row = profiles.find((p) => p.name === name);
  const editor = useBotEditor(name);
  const { base, draft, changed } = editor;
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const [modelOpen, setModelOpen] = useState(false);

  const dirty = changed.length > 0;
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  // Guard back/swipe/dismiss while edits are unsaved.
  useEffect(
    () =>
      navigation.addListener("beforeRemove", (event) => {
        if (!dirtyRef.current) return;
        event.preventDefault();
        Alert.alert("Discard changes?", "You have unsaved edits to this bot.", [
          { text: "Keep editing", style: "cancel" },
          { text: "Discard", style: "destructive", onPress: () => navigation.dispatch(event.data.action) },
        ]);
      }),
    [navigation],
  );

  const title = botTitle(row ?? name);
  const tint = botColor(name, colors);
  const isActive = activeBot === name;
  const model = draft?.model ?? (row?.model ? { provider: row.provider ?? "", model: row.model } : null);
  const description = draft ? draft.description : (row?.description ?? "");

  const chat = () => {
    setActiveBot(name);
    go.chatWith(name);
  };

  if (!row && !base && !editor.loading) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Bot" onBack={() => router.back()} />
        <EmptyState
          icon="help-circle-outline"
          title="Bot not found"
          body={editor.loadError ?? `There's no bot called “${name}”.`}
          action={<Button title="Try again" variant="secondary" onPress={editor.reload} />}
        />
      </View>
    );
  }

  const ready = !!(base && draft);

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title={title}
        subtitle={`@${name}`}
        onBack={() => router.back()}
        right={
          editor.loadError && !ready ? <IconButton icon="refresh" label="Reload bot" onPress={editor.reload} /> : undefined
        }
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + (dirty ? 120 : space.xxl) }]}
        >
          {/* Hero */}
          <View style={styles.hero}>
            <View style={[styles.halo, { backgroundColor: `${tint}14` }]}>
              <BotAvatar name={name} size={84} ring={isActive} />
            </View>
            <Text style={styles.heroTitle}>{title}</Text>
            <Text style={styles.heroRole} numberOfLines={3}>
              {botRole({ description, is_default: row?.is_default })}
            </Text>
            <View style={styles.heroMeta}>
              <View style={styles.pill}>
                <Icon name="hardware-chip-outline" size={13} color={tint} />
                <Text style={styles.pillText} numberOfLines={1}>
                  {modelLabel(model?.provider, model?.model)}
                </Text>
              </View>
              {isActive ? (
                <View style={styles.pill}>
                  <View style={styles.dot} />
                  <Text style={[styles.pillText, { color: colors.success }]}>Active</Text>
                </View>
              ) : null}
            </View>
            <Button
              title={isActive ? `Continue with ${title}` : `Chat with ${title}`}
              icon="chatbubble-ellipses"
              variant="primary"
              onPress={chat}
              style={styles.chatButton}
            />
          </View>

          {!ready ? (
            <View style={styles.sections}>
              {editor.loadError ? (
                <EmptyState
                  icon="cloud-offline-outline"
                  title="Couldn't load settings"
                  body={editor.loadError}
                  action={<Button title="Retry" variant="secondary" onPress={editor.reload} />}
                />
              ) : (
                [0, 1, 2].map((i) => (
                  <View key={i} style={styles.skeletonCard}>
                    <Skeleton lines={i === 0 ? 4 : 2} />
                  </View>
                ))
              )}
            </View>
          ) : (
            <View style={styles.sections}>
              <EditorCard icon="briefcase-outline" title="Role" hint="One line on what this bot is for. Shown across Hermes." dirty={changed.includes("description")}>
                <EditorField
                  value={draft.description}
                  onChangeText={(text) => editor.update("description", text)}
                  placeholder="e.g. Reviews pull requests for security issues"
                  multiline
                  minHeight={64}
                  accessibilityLabel="Role description"
                />
              </EditorCard>

              <EditorCard
                icon="document-text-outline"
                title="Persona & instructions"
                hint="The bot's SOUL: who it is and how it works. Markdown is fine."
                dirty={changed.includes("soul")}
                right={<Text style={styles.counter}>{draft.soul.length.toLocaleString()} chars</Text>}
              >
                <EditorField
                  value={draft.soul}
                  onChangeText={(text) => editor.update("soul", text)}
                  placeholder="You are a meticulous reviewer who…"
                  multiline
                  minHeight={180}
                  autoCorrect={false}
                  accessibilityLabel="Persona and instructions"
                />
              </EditorCard>

              <EditorCard icon="hardware-chip-outline" title="Model" dirty={changed.includes("model")}>
                <ValueRow
                  label={model?.provider ? model.provider.toUpperCase() : "PROVIDER"}
                  value={model?.model ?? "Default model"}
                  onPress={() => setModelOpen(true)}
                />
              </EditorCard>

              <VoiceCard profile={name} botName={title} />

              <ToolsetsCard
                toolsets={base.toolsets ?? []}
                enabled={draft.enabledToolsets}
                pinned={!!base.toolsets_pinned}
                dirty={changed.includes("enabledToolsets")}
                onToggle={(item, on) => editor.toggle("enabledToolsets", item, on)}
              />

              <SkillsCard
                skills={base.skills ?? []}
                disabled={draft.disabledSkills}
                dirty={changed.includes("disabledSkills")}
                onToggle={(item, on) => editor.toggle("disabledSkills", item, !on)}
                onSetAll={(next) => editor.update("disabledSkills", next)}
              />

              <McpCard
                servers={base.mcp_servers ?? []}
                enabled={draft.enabledMcp}
                dirty={changed.includes("enabledMcp")}
                onToggle={(item, on) => editor.toggle("enabledMcp", item, on)}
              />
            </View>
          )}
        </ScrollView>
        <SaveBar visible={dirty} count={changed.length} saving={editor.saving} onSave={editor.save} onDiscard={editor.discard} />
      </KeyboardAvoidingView>

      <ModelSheet
        visible={modelOpen}
        onClose={() => setModelOpen(false)}
        profile={name}
        value={draft?.model ?? null}
        onSelect={(pick) => pick && editor.update("model", pick)}
      />
    </View>
  );
}

const useStyles = makeStyles((colors, type) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: space.lg },
  hero: { alignItems: "center", paddingTop: space.lg, paddingBottom: space.xl, gap: space.sm },
  halo: { padding: space.md, borderRadius: radius.pill, marginBottom: space.sm },
  heroTitle: { ...type.display, textAlign: "center" },
  heroRole: { fontSize: 15, lineHeight: 22, color: colors.textSoft, textAlign: "center", paddingHorizontal: space.lg },
  heroMeta: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: space.sm, marginTop: space.xs },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 28,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    backgroundColor: colors.raised,
    maxWidth: "100%",
  },
  pillText: { fontSize: 13, color: colors.muted, fontWeight: "500", flexShrink: 1 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success },
  chatButton: { alignSelf: "stretch", marginTop: space.lg },
  sections: { gap: space.lg },
  skeletonCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: space.lg,
  },
  counter: { fontSize: 12, color: colors.faint },
}));
