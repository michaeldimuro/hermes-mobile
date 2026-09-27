import React, { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { errorText, useGateway } from "@/lib/store/GatewayProvider";
import { Button, Chip, Icon, Sheet } from "@/ui/primitives";
import { makeStyles, radius, space, useTheme } from "@/ui/theme";
import { BotChips } from "./BotChips";
import { deliveryLabel, describeScheduleInput, SCHEDULE_PRESETS } from "./format";
import type { CronJobCreateBody, DeliveryTarget } from "./types";
import { useKeyboardInset } from "./ui";

const CUSTOM = "custom";

/** Targets worth offering on a phone: saved locally, this bot's chat, and platform home channels. */
function usefulTargets(targets: DeliveryTarget[], bot: string): DeliveryTarget[] {
  return targets.filter(
    (t) => t.id === "local" || t.id === `bot-chat:${bot}` || (!t.id.includes(":") && t.home_target_set !== false),
  );
}

export function NewAutomationSheet({
  visible,
  onClose,
  onCreate,
  loadTargets,
}: {
  visible: boolean;
  onClose: () => void;
  onCreate: (profile: string, body: CronJobCreateBody) => Promise<unknown>;
  loadTargets: (profile: string) => Promise<DeliveryTarget[]>;
}) {
  const { profiles, activeBot } = useGateway();
  const styles = useStyles();
  const { colors, type, scheme } = useTheme();
  const keyboard = useKeyboardInset();
  const [bot, setBot] = useState(activeBot);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [preset, setPreset] = useState(SCHEDULE_PRESETS[0].id);
  const [custom, setCustom] = useState("");
  const [targets, setTargets] = useState<DeliveryTarget[]>([]);
  const [deliver, setDeliver] = useState("local");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fresh form each time the sheet opens (or the active bot changes while open).
  const [prev, setPrev] = useState({ visible, activeBot });
  if (prev.visible !== visible || prev.activeBot !== activeBot) {
    setPrev({ visible, activeBot });
    if (visible) {
      setBot(activeBot);
      setName("");
      setPrompt("");
      setPreset(SCHEDULE_PRESETS[0].id);
      setCustom("");
      setError(null);
    }
  }

  // Delivery targets are per profile; default to the bot's own chat so results land in the app.
  useEffect(() => {
    if (!visible) return;
    let live = true;
    loadTargets(bot)
      .then((all) => {
        if (!live) return;
        const useful = usefulTargets(all, bot);
        setTargets(useful);
        setDeliver(useful.some((t) => t.id === `bot-chat:${bot}`) ? `bot-chat:${bot}` : "local");
      })
      .catch(() => {
        if (!live) return;
        setTargets([]);
        setDeliver("local");
      });
    return () => {
      live = false;
    };
  }, [visible, bot, loadTargets]);

  const schedule = preset === CUSTOM ? custom.trim() : SCHEDULE_PRESETS.find((p) => p.id === preset)?.schedule ?? "";
  const preview = useMemo(() => describeScheduleInput(schedule), [schedule]);
  const canSave = prompt.trim().length > 0 && schedule.length > 0 && !saving;

  const submit = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await onCreate(bot, { name: name.trim(), prompt: prompt.trim(), schedule, deliver });
      onClose();
    } catch (err) {
      setError(errorText(err, "Hermes rejected this automation."));
    } finally {
      setSaving(false);
    }
  };

  const botChoices = profiles.length ? profiles : [{ name: activeBot }];

  return (
    <Sheet visible={visible} onClose={onClose} title="New automation">
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingBottom: space.sm + keyboard }]}
      >
        <Text style={styles.label}>BOT</Text>
        <BotChips profiles={botChoices} value={bot} onChange={setBot} inset={space.xl} />

        <View style={styles.field}>
          <Text style={styles.label}>WHAT SHOULD IT DO?</Text>
          <TextInput
            value={prompt}
            onChangeText={setPrompt}
            placeholder="e.g. Summarise my unread email and flag anything urgent"
            placeholderTextColor={colors.faint}
            keyboardAppearance={scheme}
            style={[styles.input, styles.multiline]}
            multiline
            textAlignVertical="top"
            accessibilityLabel="Automation prompt"
          />
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Name (optional)"
            placeholderTextColor={colors.faint}
            keyboardAppearance={scheme}
            style={styles.input}
            returnKeyType="done"
            accessibilityLabel="Automation name"
          />
        </View>

        <Text style={styles.label}>WHEN</Text>
        <View style={styles.wrap}>
          {SCHEDULE_PRESETS.map((p) => (
            <Chip key={p.id} label={p.label} active={preset === p.id} onPress={() => setPreset(p.id)} />
          ))}
          <Chip label="Custom" icon="create-outline" active={preset === CUSTOM} onPress={() => setPreset(CUSTOM)} />
        </View>
        {preset === CUSTOM ? (
          <View style={styles.field}>
            <TextInput
              value={custom}
              onChangeText={setCustom}
              placeholder="every 2h · weekdays at 9am · 0 9 * * 1-5"
              placeholderTextColor={colors.faint}
              keyboardAppearance={scheme}
              style={[styles.input, type.mono, { color: colors.text }]}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              accessibilityLabel="Custom schedule"
            />
            <Text style={type.small}>
              Intervals (30m, every 2h), one-shots (in 45m, 2026-10-01T09:00), phrases (every monday 9am) or cron.
            </Text>
          </View>
        ) : null}
        {schedule ? (
          <View style={styles.preview} accessibilityLiveRegion="polite">
            <Icon
              name={preview.ok ? "time-outline" : "help-circle-outline"}
              size={15}
              color={preview.ok ? colors.accentText : colors.warn}
            />
            <Text style={[type.small, { color: preview.ok ? colors.textSoft : colors.warn, flex: 1 }]}>
              {preview.ok ? preview.label : "Hermes will check this schedule when you save."}
            </Text>
          </View>
        ) : null}

        <Text style={styles.label}>SEND RESULTS TO</Text>
        <View style={styles.wrap}>
          {(targets.length ? targets : [{ id: "local", name: "Local" }]).map((t) => (
            <Chip
              key={t.id}
              label={deliveryLabel(t.id)}
              active={deliver === t.id}
              onPress={() => setDeliver(t.id)}
            />
          ))}
        </View>

        {error ? (
          <View style={styles.error}>
            <Text style={[type.small, { color: colors.danger }]}>{error}</Text>
          </View>
        ) : null}

        <Button
          title="Create automation"
          icon="alarm-outline"
          variant="accent"
          loading={saving}
          disabled={!canSave}
          onPress={submit}
          style={{ marginHorizontal: space.xl, marginTop: space.sm }}
        />
      </ScrollView>
    </Sheet>
  );
}

const useStyles = makeStyles((colors, type) => ({
  content: { gap: space.md },
  label: { ...type.caption, paddingHorizontal: space.xl, marginTop: space.xs },
  field: { gap: space.sm, paddingHorizontal: space.xl },
  input: {
    color: colors.text,
    fontSize: 16,
    backgroundColor: colors.raised,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
  },
  multiline: { minHeight: 92, maxHeight: 160 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, paddingHorizontal: space.xl },
  preview: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.xl },
  error: { marginHorizontal: space.xl, padding: space.md, borderRadius: radius.md, backgroundColor: colors.dangerBg },
}));
