import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import type { SessionLiveInfo } from "@/lib/gateway/types";
import { Chip, Icon, IconButton, IconName, PressableRow, PressScale, Sheet } from "@/ui/primitives";
import Animated from "react-native-reanimated";
import { SWAP_IN } from "@/ui/motion";
import { makeStyles, radius, space, useTheme } from "@/ui/theme";
import { applySuggestion, detectTrigger } from "./composerText";
import { SuggestionPanel } from "./SuggestionPanel";
import { pickedFileDataUrl } from "./fileData";
import type { Attachment } from "./useChatSession";

/** Hermes stages uploads in the session workspace; keep phones from pushing huge blobs over the socket. */
const MAX_FILE_BYTES = 20 * 1024 * 1024;

type Props = {
  botName: string;
  /** Profile whose skills `/` lists. */
  profile: string;
  running: boolean;
  info: SessionLiveInfo | null;
  attachments: Attachment[];
  draft: string;
  setDraft: (text: string) => void;
  /** Resolves with text to put back in the composer (e.g. `/undo`), if any. */
  onSend: (text: string) => Promise<string | undefined> | void;
  onStop: () => void;
  onAttachImage: (image: { uri: string; base64: string; fileName?: string | null }) => void;
  onAttachFile: (file: { name: string; dataUrl?: string; path?: string }) => void;
  /** Files already on the Hermes machine from this chat (bot-shared), offered for re-attaching. */
  recentFiles?: { name: string; path: string }[];
  onRemoveAttachment: (attachment: Attachment) => void;
  onAside: (text: string, mode: "btw" | "background") => void;
  onConfigure: (key: "reasoning" | "fast", value: string) => void;
  /** Hold-to-talk dictation (transcribed by Hermes); absent hides the mic. */
  voice?: {
    recording: boolean;
    transcribing: boolean;
    start: () => Promise<boolean>;
    stop: () => Promise<string>;
  };
  /** Switch to a spoken conversation; absent hides the button. */
  onVoiceMode?: () => void;
  /** A mode the next send runs in (editing a message, asking about a reply), with a way out. */
  banner?: { icon: IconName; label: string; onCancel: () => void } | null;
};

const EFFORTS = [
  { value: "none", label: "Off", detail: "Answer directly, fastest" },
  { value: "low", label: "Low", detail: "Light reasoning" },
  { value: "medium", label: "Medium", detail: "Balanced (default for most bots)" },
  { value: "high", label: "High", detail: "Deeper analysis, slower" },
  { value: "xhigh", label: "Max", detail: "Maximum effort for hard problems" },
];

export function Composer(props: Props) {
  const styles = useStyles();
  const { colors, type } = useTheme();
  const { draft, setDraft, running, info } = props;
  const [menu, setMenu] = useState(false);
  const [effortSheet, setEffortSheet] = useState(false);
  const [cursor, setCursor] = useState(draft.length);
  const [dismissedAt, setDismissedAt] = useState<string | null>(null);
  const input = useRef<TextInput>(null);
  const effort = String(info?.reasoning_effort || "medium");
  const fast = Boolean(info?.fast);
  const canSend = draft.trim().length > 0 || props.attachments.length > 0;
  const { voice } = props;
  const mode = running && !canSend ? "stop" : canSend ? "send" : voice ? "mic" : "idle";
  const pressedAt = useRef(0);
  const startTalking = () => {
    pressedAt.current = Date.now();
    void voice?.start();
  };
  const stopTalking = () => {
    if (!voice) return;
    const quick = Date.now() - pressedAt.current < 350;
    void voice.stop().then((text) => {
      if (quick && !text) return Alert.alert("Hold to talk", "Press and hold the mic while you speak, then let go.");
      if (!text) return;
      const next = draft ? `${draft.trimEnd()} ${text}` : text;
      setDraft(next);
      setCursor(next.length);
    });
  };
  // The cursor can lag the text by a frame; clamp so typing at the end always counts.
  const caret = Math.min(cursor, draft.length);
  const rawTrigger = detectTrigger(draft, caret >= draft.length - 1 ? draft.length : caret);
  const trigger = rawTrigger && dismissedAt !== draft ? rawTrigger : null;

  const change = (text: string) => {
    setDraft(text);
    if (text.length > draft.length && caret >= draft.length) setCursor(text.length);
  };

  const pickSuggestion = (insert: string) => {
    if (!trigger) return;
    const next = applySuggestion(draft, trigger, insert);
    setDraft(next.text);
    setCursor(next.cursor);
    setDismissedAt(next.text);
    input.current?.focus();
  };

  const send = () => {
    if (!canSend) return;
    const text = draft.trim() || "What's in this image?";
    setDraft("");
    setCursor(0);
    Promise.resolve(props.onSend(text))
      .then((restore) => {
        if (restore) {
          setDraft(restore);
          setCursor(restore.length);
        }
      })
      .catch(() => undefined);
  };

  const pick = async (source: "library" | "camera") => {
    setMenu(false);
    const permission =
      source === "camera" ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return Alert.alert("Permission needed", `Allow ${source === "camera" ? "camera" : "photo"} access in Settings.`);
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], base64: true, quality: 0.7 };
    const result = source === "camera" ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync({ ...options, allowsMultipleSelection: true, selectionLimit: 4 });
    if (result.canceled) return;
    for (const asset of result.assets) if (asset.base64) props.onAttachImage({ uri: asset.uri, base64: asset.base64, fileName: asset.fileName });
  };

  const [recentSheet, setRecentSheet] = useState(false);
  const pickDocument = async () => {
    setMenu(false);
    const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
    if (result.canceled) return;
    for (const asset of result.assets) {
      if (asset.size && asset.size > MAX_FILE_BYTES) {
        Alert.alert("File too large", `${asset.name} is over 20 MB.`);
        continue;
      }
      try {
        props.onAttachFile({ name: asset.name, dataUrl: await pickedFileDataUrl(asset) });
      } catch {
        Alert.alert("Couldn't read file", asset.name);
      }
    }
  };

  const aside = (mode: "btw" | "background") => {
    setMenu(false);
    const text = draft.trim();
    if (!text) return Alert.alert(mode === "btw" ? "Ask on the side" : "Background task", "Type your question or task first, then choose this option.");
    setDraft("");
    props.onAside(text, mode);
  };

  const [focusRequest, setFocusRequest] = useState(0);
  useEffect(() => {
    if (focusRequest) input.current?.focus();
  }, [focusRequest]);
  // Entering a mode (edit, ask about) puts the cursor in the box, ready to type.
  const bannerLabel = props.banner?.label;
  useEffect(() => {
    if (bannerLabel) input.current?.focus();
  }, [bannerLabel]);

  const startWith = (prefix: string) => {
    setMenu(false);
    const next = prefix === "@" ? `${draft}${draft && !draft.endsWith(" ") ? " " : ""}@` : prefix;
    setDraft(next);
    setCursor(next.length);
    setDismissedAt(null);
    setFocusRequest((n) => n + 1);
  };

  const menuItems: { icon: IconName; title: string; detail: string; onPress: () => void }[] = [
    { icon: "images-outline", title: "Photos", detail: "Attach images for the bot to see", onPress: () => pick("library") },
    { icon: "camera-outline", title: "Camera", detail: "Take a photo", onPress: () => pick("camera") },
    { icon: "document-attach-outline", title: "Files", detail: "PDFs, docs, spreadsheets, anything", onPress: () => void pickDocument() },
    ...(props.recentFiles?.length
      ? [
          {
            icon: "folder-open-outline" as const,
            title: "From this chat",
            detail: "Re-use a file a bot already shared",
            onPress: () => {
              setMenu(false);
              setRecentSheet(true);
            },
          },
        ]
      : []),
    { icon: "chatbubbles-outline", title: "Ask on the side", detail: "Quick /btw question without derailing the current task", onPress: () => aside("btw") },
    { icon: "rocket-outline", title: "Run in background", detail: "Spin off a parallel agent for this task", onPress: () => aside("background") },
    { icon: "flash-outline", title: "Run a skill", detail: `Everything ${props.botName} can run. Or type / in a message.`, onPress: () => startWith("/") },
    { icon: "at-outline", title: "Mention a bot", detail: "Refer to another bot. Or type @ in a message.", onPress: () => startWith("@") },
    { icon: "flag-outline", title: "Set a goal", detail: "The bot keeps working across turns until it's achieved", onPress: () => startWith("/goal ") },
    { icon: "repeat-outline", title: "Repeat on a schedule", detail: "Re-run a prompt, e.g. “10m check the deploy”", onPress: () => startWith("/loop ") },
  ];

  return (
    <View style={styles.dock}>
      <SuggestionPanel trigger={trigger} profile={props.profile} onPick={pickSuggestion} />
      {props.banner ? (
        <Animated.View entering={SWAP_IN} style={styles.banner}>
          <Icon name={props.banner.icon} size={15} color={colors.accentText} />
          <Text style={styles.bannerText} numberOfLines={1}>
            {props.banner.label}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            hitSlop={10}
            onPress={() => {
              props.banner?.onCancel();
              setDraft("");
            }}
          >
            <Icon name="close" size={16} color={colors.muted} />
          </Pressable>
        </Animated.View>
      ) : null}
      <View style={styles.box}>
        {props.attachments.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbs}>
            {props.attachments.map((attachment) => (
              <View key={attachment.id}>
                {attachment.kind === "file" ? (
                  <View style={styles.fileChip}>
                    <Icon name="document-text-outline" size={18} color={colors.textSoft} />
                    <Text style={styles.fileName} numberOfLines={2}>
                      {attachment.name}
                    </Text>
                  </View>
                ) : (
                  <Image source={{ uri: attachment.uri }} style={styles.thumb} />
                )}
                <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${attachment.name}`} onPress={() => props.onRemoveAttachment(attachment)} style={styles.thumbRemove}>
                  <Icon name="close" size={12} color={colors.text} />
                </Pressable>
              </View>
            ))}
          </ScrollView>
        ) : null}
        <TextInput
          ref={input}
          value={draft}
          onChangeText={change}
          onSelectionChange={(event) => setCursor(event.nativeEvent.selection.end)}
          onKeyPress={(event) => event.nativeEvent.key === "Escape" && setDismissedAt(draft)}
          placeholder={voice?.recording ? "Listening… let go when you're done" : `Message ${props.botName}`}
          placeholderTextColor={colors.faint}
          multiline
          style={styles.input}
          accessibilityLabel="Message"
        />
        <View style={styles.controls}>
          <IconButton icon="add" label="Attach or more actions" size={22} filled onPress={() => setMenu(true)} style={styles.round} />
          <Chip label={effort === "none" ? "Think off" : `Think · ${EFFORTS.find((e) => e.value === effort)?.label ?? effort}`} icon="bulb-outline" active={effort !== "none"} tint={colors.accentText} onPress={() => setEffortSheet(true)} />
          <Chip label="Fast" icon="flash-outline" active={fast} tint={colors.accentText} onPress={() => props.onConfigure("fast", fast ? "normal" : "fast")} />
          <View style={{ flex: 1 }} />
          {props.onVoiceMode && !canSend && !voice?.recording ? (
            <Animated.View entering={SWAP_IN}>
              <PressScale
                accessibilityRole="button"
                accessibilityLabel="Voice mode"
                accessibilityHint={`Talk with ${props.botName} hands-free. The conversation is still written into the chat.`}
                onPress={props.onVoiceMode}
                style={[styles.send, styles.mic]}
              >
                <Icon name="pulse" size={20} color={colors.textSoft} />
              </PressScale>
            </Animated.View>
          ) : null}
          {mode === "mic" ? (
            <PressScale
              accessibilityRole="button"
              accessibilityLabel="Hold to talk"
              accessibilityHint="Hold, speak, then release. Hermes types what you said."
              onPressIn={startTalking}
              onPressOut={stopTalking}
              scaleTo={1.12}
              style={[styles.send, voice?.recording ? styles.recording : styles.mic]}
            >
              <Animated.View key={voice?.transcribing ? "wait" : "mic"} entering={SWAP_IN}>
                {voice?.transcribing ? (
                  <ActivityIndicator size="small" color={colors.textSoft} />
                ) : (
                  <Icon name={voice?.recording ? "mic" : "mic-outline"} size={20} color={voice?.recording ? colors.primaryInk : colors.textSoft} />
                )}
              </Animated.View>
            </PressScale>
          ) : (
            <PressScale
              accessibilityRole="button"
              accessibilityLabel={mode === "stop" ? "Stop" : running ? "Queue message" : "Send"}
              disabled={mode === "idle"}
              onPress={mode === "stop" ? props.onStop : send}
              style={[styles.send, mode === "idle" && styles.sendDisabled]}
            >
              {/* Keyed so the glyph settles in when the button changes meaning. */}
              <Animated.View key={mode === "stop" ? "stop" : "send"} entering={SWAP_IN}>
                {mode === "stop" ? (
                  <View style={styles.stopSquare} />
                ) : (
                  <Icon name="arrow-up" size={20} color={canSend ? colors.primaryInk : colors.faint} />
                )}
              </Animated.View>
            </PressScale>
          )}
        </View>
      </View>

      <Sheet visible={menu} onClose={() => setMenu(false)}>
        {menuItems.map((item) => (
          <PressableRow key={item.title} onPress={item.onPress} style={{ marginHorizontal: space.sm }}>
            <View style={styles.menuIcon}>
              <Icon name={item.icon} size={20} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={type.heading}>{item.title}</Text>
              <Text style={type.small}>{item.detail}</Text>
            </View>
          </PressableRow>
        ))}
      </Sheet>

      <Sheet visible={effortSheet} onClose={() => setEffortSheet(false)} title="Reasoning effort">
        {EFFORTS.map((option) => (
          <PressableRow
            key={option.value}
            onPress={() => {
              setEffortSheet(false);
              props.onConfigure("reasoning", option.value);
            }}
            style={{ marginHorizontal: space.sm }}
          >
            <View style={{ flex: 1 }}>
              <Text style={type.heading}>{option.label}</Text>
              <Text style={type.small}>{option.detail}</Text>
            </View>
            {effort === option.value ? <Icon name="checkmark" size={20} color={colors.accentText} /> : null}
          </PressableRow>
        ))}
      </Sheet>

      <Sheet visible={recentSheet} onClose={() => setRecentSheet(false)} title="Files from this chat">
        <ScrollView style={{ maxHeight: 420 }}>
          {(props.recentFiles ?? []).map((file) => (
            <PressableRow
              key={file.path}
              onPress={() => {
                setRecentSheet(false);
                props.onAttachFile({ name: file.name, path: file.path });
              }}
              style={{ marginHorizontal: space.sm }}
            >
              <Icon name="document-outline" size={20} color={colors.textSoft} />
              <View style={{ flex: 1 }}>
                <Text style={type.heading} numberOfLines={1}>
                  {file.name}
                </Text>
                <Text style={type.small} numberOfLines={1}>
                  {file.path}
                </Text>
              </View>
            </PressableRow>
          ))}
        </ScrollView>
      </Sheet>
    </View>
  );
}

const useStyles = makeStyles((colors, type) => ({
  dock: { paddingHorizontal: space.md, paddingTop: space.xs },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.xs + 2,
    marginBottom: space.xs,
  },
  bannerText: { flex: 1, color: colors.textSoft, fontSize: 13 },
  box: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    paddingTop: space.sm,
    paddingBottom: space.sm,
    paddingHorizontal: space.sm,
  },
  input: { color: colors.text, fontSize: 17, lineHeight: 23, maxHeight: 160, minHeight: 40, paddingHorizontal: space.sm, paddingTop: 6, paddingBottom: 6 },
  controls: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.xs },
  round: { width: 36, height: 36 },
  send: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  sendDisabled: { backgroundColor: colors.raised },
  stop: { backgroundColor: colors.primary },
  mic: { backgroundColor: colors.raised },
  recording: { backgroundColor: colors.danger },
  stopSquare: { width: 13, height: 13, borderRadius: 3, backgroundColor: colors.primaryInk },
  thumbs: { gap: space.sm, paddingHorizontal: space.xs, paddingBottom: space.sm },
  thumb: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.raised },
  fileChip: {
    width: 132,
    height: 64,
    borderRadius: radius.md,
    backgroundColor: colors.raised,
    padding: space.sm,
    gap: 2,
  },
  fileName: { color: colors.textSoft, fontSize: 12, lineHeight: 15 },
  thumbRemove: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.overlay,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  menuIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.raised, alignItems: "center", justifyContent: "center" },
}));
