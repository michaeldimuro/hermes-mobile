import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  LayoutChangeEvent,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { resolveWsUrl } from "@/lib/gateway/rest";
import { useGateway } from "@/lib/store/GatewayProvider";
import { Button, haptic, IconButton } from "@/ui/primitives";
import { makeStyles, radius, space, useTheme } from "@/ui/theme";
import { activeTab, click, displayHost, key, SpecialKey, StreamMessage, toPage, typing, type Box, type Viewport } from "./remoteInput";
import { PLUGIN } from "./useChatBrowser";

type Props = {
  visible: boolean;
  task: string | null;
  botName: string;
  /** Done: you finished in the browser (the bot continues). */
  onDone: () => void;
  /** Closed without finishing. */
  onClose: () => void;
};

const DESKTOP = { width: 1280, height: 720 };
type Link = "connecting" | "live" | "closed";

/**
 * The bot's browser, live, on the phone: tap to click, drag to scroll, type in the bar below (it goes
 * straight into the page, never into the chat). While open, the page is sized for the phone; it goes back
 * to desktop size when you leave.
 */
export function BrowserViewer({ visible, task, botName, onDone, onClose }: Props) {
  return (
    <Modal visible={visible && Boolean(task)} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      {visible && task ? <Viewer task={task} botName={botName} onDone={onDone} onClose={onClose} /> : null}
    </Modal>
  );
}

function Viewer({ task, botName, onDone, onClose }: { task: string; botName: string; onDone: () => void; onClose: () => void }) {
  const styles = useStyles();
  const { colors, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const { config, get } = useGateway();
  // A plain holder, not a ref: gesture callbacks built during render send through it.
  const [socket] = useState<{ current: WebSocket | null }>(() => ({ current: null }));
  const [link, setLink] = useState<Link>("connecting");
  const [frame, setFrame] = useState<string | null>(null);
  const [viewport, setViewport] = useState<Viewport>(DESKTOP);
  const [tab, setTab] = useState<{ title: string; url: string } | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [typed, setTyped] = useState("");
  const [secure, setSecure] = useState(false);
  const input = useRef<TextInput>(null);

  // Connect to the relayed stream (the same sign-in as the rest of the app).
  useEffect(() => {
    if (!config) return;
    let live = true;
    void Promise.resolve(resolveWsUrl(config, `${PLUGIN}/stream?task=${encodeURIComponent(task)}`)).then((url) => {
      if (!live) return;
      const ws = new WebSocket(url);
      socket.current = ws;
      ws.onmessage = (event) => {
        let message: Record<string, any>;
        try {
          message = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (message.type === "frame" && typeof message.data === "string") {
          setFrame(`data:image/jpeg;base64,${message.data}`);
          setLink("live");
          const meta = message.metadata ?? {};
          if (meta.deviceWidth && meta.deviceHeight) setViewport({ width: meta.deviceWidth, height: meta.deviceHeight });
        } else if (message.type === "tabs") {
          setTab(activeTab(message));
        }
      };
      ws.onclose = () => live && setLink("closed");
    });
    return () => {
      live = false;
      socket.current?.close();
      socket.current = null;
    };
  }, [config, socket, task]);

  // Phone-sized page while you drive it; desktop-sized again for the bot afterwards.
  const sized = useRef(false);
  useEffect(() => {
    if (!box || sized.current) return;
    sized.current = true;
    void get(`${PLUGIN}/viewport`, {
      method: "POST",
      body: JSON.stringify({ task, width: Math.round(box.width), height: Math.round(box.height) }),
    }).catch(() => undefined);
  }, [box, get, task]);
  useEffect(
    () => () => {
      if (!sized.current) return;
      void get(`${PLUGIN}/viewport`, { method: "POST", body: JSON.stringify({ task, ...DESKTOP }) }).catch(() => undefined);
    },
    [get, task],
  );

  const send = (messages: StreamMessage[]) => {
    const ws = socket.current;
    if (ws?.readyState !== WebSocket.OPEN) return;
    for (const message of messages) ws.send(JSON.stringify(message));
  };

  // The stage shrinks when the keyboard opens (the picture scales down with it), so taps must map
  // against its current size, not the first one.
  const measure = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setBox((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }));
  };
  const at = (x: number, y: number) => (box ? toPage(x, y, box, viewport) : null);
  const tap = Gesture.Tap()
    .runOnJS(true)
    .onEnd((event) => {
      const point = at(event.x, event.y);
      if (!point) return;
      haptic.tap();
      send(click(point.x, point.y));
      setTyped(""); // a new field: the typing bar starts fresh
    });
  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(6)
    .onChange((event) => {
      const point = at(event.x, event.y);
      if (!point || !box) return;
      const scale = Math.min(box.width / viewport.width, box.height / viewport.height);
      send([{ type: "input_mouse", eventType: "mouseWheel", x: point.x, y: point.y, button: "none", clickCount: 0, deltaX: -event.changeX / scale, deltaY: -event.changeY / scale, modifiers: 0 }]);
    });
  const gesture = Gesture.Exclusive(pan, tap);

  const change = (next: string) => {
    send(typing(typed, next));
    setTyped(next);
  };
  const press = (name: SpecialKey) => {
    haptic.tap();
    send(key(name));
    if (name !== "Backspace") setTyped("");
    else setTyped((prev) => Array.from(prev).slice(0, -1).join(""));
  };

  const title = tab?.title || `${botName}'s browser`;
  const host = tab?.url ? displayHost(tab.url) : "";

  return (
    <GestureHandlerRootView style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <IconButton icon="close" label="Close screen share" onPress={onClose} />
        <View style={styles.titleBox}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <View style={styles.hostRow}>
            <View style={[styles.dot, { backgroundColor: link === "live" ? colors.success : link === "closed" ? colors.danger : colors.warn }]} />
            <Text style={styles.host} numberOfLines={1}>
              {link === "closed" ? "Disconnected" : host || (link === "live" ? "Live" : "Connecting…")}
            </Text>
          </View>
        </View>
        <Button title="Done" variant="primary" onPress={onDone} style={styles.done} />
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <GestureDetector gesture={gesture}>
          <View style={styles.stage} onLayout={measure}>
            {frame ? (
              <Image source={{ uri: frame }} style={styles.frame} resizeMode="contain" fadeDuration={0} accessibilityLabel={`${botName}'s browser: ${title}`} />
            ) : link === "closed" ? (
              <Text style={styles.status}>The browser closed. Ask {botName} to open the page again.</Text>
            ) : (
              <ActivityIndicator color={colors.muted} />
            )}
          </View>
        </GestureDetector>

        <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, space.sm) }]}>
          <View style={styles.inputRow}>
            <TextInput
              ref={input}
              value={typed}
              onChangeText={change}
              onSubmitEditing={() => press("Enter")}
              submitBehavior="submit"
              placeholder="Tap a field on the page, then type here"
              placeholderTextColor={colors.faint}
              keyboardAppearance={scheme}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              secureTextEntry={secure}
              textContentType={secure ? "password" : "username"}
              autoComplete={secure ? "current-password" : "username"}
              style={styles.input}
              accessibilityLabel="Type into the page"
            />
            <IconButton
              icon={secure ? "eye-off-outline" : "eye-outline"}
              label={secure ? "Show what I type" : "Hide what I type (passwords)"}
              onPress={() => setSecure((on) => !on)}
            />
          </View>
          <View style={styles.keys}>
            {(["Tab", "Enter", "Backspace"] as const).map((name) => (
              <Pressable
                key={name}
                accessibilityRole="button"
                accessibilityLabel={name === "Enter" ? "Return" : name}
                onPress={() => press(name)}
                style={({ pressed }) => [styles.key, pressed && { opacity: 0.6 }]}
              >
                <Text style={styles.keyText}>{name === "Enter" ? "return" : name === "Backspace" ? "delete" : "tab"}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </KeyboardAvoidingView>
    </GestureHandlerRootView>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm },
  titleBox: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: 16, fontWeight: "600" },
  hostRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  host: { color: colors.muted, fontSize: 12, flexShrink: 1 },
  done: { minWidth: 76 },
  stage: { flex: 1, backgroundColor: colors.raised, alignItems: "center", justifyContent: "center" },
  frame: { width: "100%", height: "100%" },
  status: { color: colors.muted, fontSize: 14, textAlign: "center", paddingHorizontal: space.xl },
  bar: { paddingHorizontal: space.md, paddingTop: space.sm, gap: space.sm, backgroundColor: colors.bg },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
    paddingLeft: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  input: { flex: 1, color: colors.text, fontSize: 16, minHeight: 44 },
  keys: { flexDirection: "row", gap: space.sm },
  key: { flex: 1, height: 36, borderRadius: radius.md, backgroundColor: colors.raised, alignItems: "center", justifyContent: "center" },
  keyText: { color: colors.textSoft, fontSize: 13, fontWeight: "500" },
}));
