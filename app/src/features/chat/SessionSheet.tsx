import React, { useState } from "react";
import { ActivityIndicator, Alert, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { errorText, useGateway } from "@/lib/store/GatewayProvider";
import type { ModelOptionsResult, SessionLiveInfo, Usage } from "@/lib/gateway/types";
import { Button, Icon, PressableRow, Sheet } from "@/ui/primitives";
import { makeStyles, radius, space, useTheme } from "@/ui/theme";

type Props = {
  visible: boolean;
  onClose: () => void;
  profile: string;
  title: string;
  info: SessionLiveInfo | null;
  usage: Usage | null;
  canDelete: boolean;
  onRename: (title: string) => void;
  onModel: (model: string, provider: string) => void;
  onYolo: (on: boolean) => void;
  onCompress: () => void;
  onDelete: () => void;
  /** Stored session id; moving the working folder needs one. */
  storedId?: string | null;
  onSearch?: () => void;
};

const fmt = (n?: number | null) => (typeof n === "number" ? (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n)) : "?");

/** Per-conversation controls: model, approvals, context, title, delete. */
export function SessionSheet(props: Props) {
  const styles = useStyles();
  const { colors, type } = useTheme();
  const { call, showToast } = useGateway();
  const [title, setTitle] = useState(props.title);
  const [syncedTitle, setSyncedTitle] = useState(props.title);
  // Adopt server-side renames (auto-titling) without an effect.
  if (props.title !== syncedTitle) {
    setSyncedTitle(props.title);
    setTitle(props.title);
  }
  const [models, setModels] = useState<ModelOptionsResult | null>(null);
  const [picking, setPicking] = useState(false);
  const [folder, setFolder] = useState<{ cwd: string; branch?: string | null } | null>(null);
  const [editingFolder, setEditingFolder] = useState(false);
  const [folderDraft, setFolderDraft] = useState("");
  const cwd = folder?.cwd ?? String(props.info?.cwd ?? "");
  const branch = folder ? folder.branch : (props.info?.branch as string | null | undefined);

  const moveFolder = async () => {
    const next = folderDraft.trim();
    if (!next || !props.storedId) return;
    try {
      const result = await call<{ cwd: string; branch?: string | null }>("session.workspace.move", {
        session_key: props.storedId,
        cwd: next,
        profile: props.profile,
      });
      setFolder(result);
      setEditingFolder(false);
      showToast(`Now working in ${result.cwd}`, "success");
    } catch (error) {
      showToast(errorText(error, "Could not switch folder"), "error");
    }
  };

  const openModels = async () => {
    setPicking(true);
    if (models) return;
    try {
      setModels(await call<ModelOptionsResult>("model.options", { profile: props.profile, explicit_only: true }));
    } catch (error) {
      showToast(errorText(error, "Could not load models"), "error");
      setPicking(false);
    }
  };

  const usage = props.usage;
  const percent = Math.min(100, Math.max(0, Number(usage?.context_percent ?? 0)));

  return (
    <Sheet visible={props.visible} onClose={() => (picking ? setPicking(false) : props.onClose())} title={picking ? "Model for this chat" : "Chat settings"}>
      {picking ? (
        <ScrollView style={{ maxHeight: 460 }}>
          {!models ? <ActivityIndicator color={colors.accentText} style={{ margin: space.xl }} /> : null}
          {models?.providers
            .filter((provider) => provider.authenticated !== false && provider.models?.length)
            .map((provider) => (
              <View key={provider.slug}>
                <Text style={styles.group}>{provider.name}</Text>
                {(provider.models ?? []).map((model) => {
                  const current = props.info?.model === model;
                  return (
                    <PressableRow
                      key={model}
                      style={styles.row}
                      onPress={() => {
                        props.onModel(model, provider.slug);
                        setPicking(false);
                        props.onClose();
                      }}
                    >
                      <Text style={[type.body, { flex: 1 }]}>{model}</Text>
                      {current ? <Icon name="checkmark" size={18} color={colors.accentText} /> : null}
                    </PressableRow>
                  );
                })}
              </View>
            ))}
        </ScrollView>
      ) : (
        <ScrollView style={{ maxHeight: 560 }} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <Text style={styles.label}>Context window</Text>
            <View style={styles.meter}>
              <View style={[styles.meterFill, { width: `${percent}%`, backgroundColor: percent > 80 ? colors.warn : colors.accent }]} />
            </View>
            <Text style={type.small}>
              {`${fmt(usage?.context_used)} / ${fmt(usage?.context_max)} tokens · ${percent}%`}
              {typeof usage?.cost_usd === "number" && usage.cost_usd > 0 ? ` · $${usage.cost_usd.toFixed(3)}` : ""}
            </Text>
            <Button title="Compress context" variant="secondary" icon="contract-outline" onPress={props.onCompress} style={{ marginTop: space.sm, minHeight: 40 }} />
          </View>

          {cwd ? (
            <View style={styles.card}>
              <Text style={styles.label}>Project folder</Text>
              {editingFolder ? (
                <TextInput
                  value={folderDraft}
                  onChangeText={setFolderDraft}
                  placeholder="/Users/you/Projects/app"
                  placeholderTextColor={colors.faint}
                  style={styles.input}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={moveFolder}
                />
              ) : (
                <Text style={[type.body, styles.path]} numberOfLines={2}>
                  {cwd}
                </Text>
              )}
              <View style={styles.inline}>
                <Text style={[type.small, { flex: 1 }]}>{branch ? `Git branch ${branch}` : "Not a git repository"}</Text>
                {props.storedId ? (
                  editingFolder ? (
                    <Button title="Move" variant="secondary" onPress={moveFolder} style={styles.smallButton} />
                  ) : (
                    <Button
                      title="Change"
                      variant="ghost"
                      onPress={() => {
                        setFolderDraft(cwd);
                        setEditingFolder(true);
                      }}
                      style={styles.smallButton}
                    />
                  )
                ) : null}
              </View>
            </View>
          ) : null}

          {props.onSearch ? (
            <PressableRow onPress={props.onSearch} style={styles.card}>
              <Icon name="search" size={20} color={colors.textSoft} />
              <View style={{ flex: 1 }}>
                <Text style={type.heading}>Search in this chat</Text>
              </View>
              <Icon name="chevron-forward" size={18} color={colors.faint} />
            </PressableRow>
          ) : null}

          <PressableRow onPress={openModels} style={styles.card}>
            <Icon name="hardware-chip-outline" size={20} color={colors.textSoft} />
            <View style={{ flex: 1 }}>
              <Text style={type.heading}>Model</Text>
              <Text style={type.small}>{[props.info?.provider, props.info?.model].filter(Boolean).join(" · ") || "Bot default"}</Text>
            </View>
            <Icon name="chevron-forward" size={18} color={colors.faint} />
          </PressableRow>

          <View style={[styles.card, styles.inline]}>
            <Icon name="flash-outline" size={20} color={colors.textSoft} />
            <View style={{ flex: 1 }}>
              <Text style={type.heading}>Auto-approve commands</Text>
              <Text style={type.small}>Skip approval prompts in this chat (YOLO).</Text>
            </View>
            <Switch
              value={Boolean(props.info?.yolo)}
              onValueChange={(on) =>
                on
                  ? Alert.alert("Auto-approve?", "The bot will run commands in this chat without asking.", [
                      { text: "Cancel", style: "cancel" },
                      { text: "Enable", style: "destructive", onPress: () => props.onYolo(true) },
                    ])
                  : props.onYolo(false)
              }
              trackColor={{ true: colors.accent, false: colors.raised }}
            />
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>Title</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Untitled chat"
              placeholderTextColor={colors.faint}
              style={styles.input}
              returnKeyType="done"
              onSubmitEditing={() => title.trim() && props.onRename(title.trim())}
              onEndEditing={() => title.trim() && title.trim() !== props.title && props.onRename(title.trim())}
            />
          </View>

          {props.canDelete ? (
            <Button
              title="Delete chat"
              variant="danger"
              icon="trash-outline"
              onPress={() =>
                Alert.alert("Delete this chat?", "The conversation is removed from Hermes.", [
                  { text: "Cancel", style: "cancel" },
                  { text: "Delete", style: "destructive", onPress: props.onDelete },
                ])
              }
            />
          ) : null}
        </ScrollView>
      )}
    </Sheet>
  );
}

const useStyles = makeStyles((colors, type) => ({
  body: { paddingHorizontal: space.lg, gap: space.md, paddingBottom: space.md },
  card: { backgroundColor: colors.raised, borderRadius: radius.lg, padding: space.md, gap: space.xs },
  inline: { flexDirection: "row", alignItems: "center", gap: space.md },
  label: { ...type.caption, marginBottom: 2 },
  meter: { height: 6, borderRadius: 3, backgroundColor: colors.overlay, overflow: "hidden", marginVertical: space.xs },
  meterFill: { height: 6, borderRadius: 3 },
  input: { color: colors.text, fontSize: 16, paddingVertical: 6 },
  group: { ...type.caption, paddingHorizontal: space.xl, marginTop: space.md, marginBottom: space.xs },
  row: { marginHorizontal: space.sm },
  path: { fontFamily: type.mono.fontFamily, fontSize: 14 },
  smallButton: { minHeight: 34, paddingHorizontal: space.md },
}));
