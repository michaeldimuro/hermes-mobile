import React, { useCallback, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";
import { Href, router, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { errorText, useGateway } from "@/lib/store/GatewayProvider";
import { makeStyles, space } from "@/ui/theme";
import { BotSwitcher } from "./BotSwitcher";
import { botTitle, findBot } from "./botMeta";
import { ChatHeader } from "./ChatHeader";
import { ChatList, ChatSkeleton } from "./ChatList";
import type { TimelineItem, UserItem } from "./chatReducer";
import { Composer } from "./Composer";
import { HomeHero } from "./HomeHero";
import { LiveActivity } from "./LiveActivity";
import { ChatScope, MessageActionsContext, MessageItem } from "./MessageItem";
import { RequestCard } from "./RequestCard";
import { SessionSheet } from "./SessionSheet";
import { SubagentSheet } from "./SubagentSheet";
import { ControlCard } from "./ControlCard";
import { useSessionControl } from "./useSessionControl";
import { useVoice } from "./useVoice";
import { VoicePanel } from "@/features/voice/VoicePanel";
import { asksForSignIn, BrowserShareCard } from "@/features/browser/BrowserShareCard";
import { BrowserViewer } from "@/features/browser/BrowserViewer";
import { useChatBrowser } from "@/features/browser/useChatBrowser";
import { ChatSearchBar, searchTimeline } from "./ChatSearch";
import { useTurnActivity } from "@/widgets/useTurnActivity";
import { useSharedDraft } from "@/features/share/useSharedDraft";
import { useChatSession } from "./useChatSession";
import Animated from "react-native-reanimated";
import { CARD_IN, CARD_OUT } from "@/ui/motion";

/** A fresh, standalone session with `bot` (it shows up under Sessions, not as the bot's conversation). */
export const newChat = (bot: string) =>
  router.replace(`/new?bot=${encodeURIComponent(bot)}&n=${Date.now()}` as Href);

/** The bot's continuous conversation (its Hermes "Bot Chat"). */
export const botConversation = (bot: string) =>
  router.replace(`/bot/${encodeURIComponent(bot)}` as Href);

/** "hermes-mobile (main)" when the chat works inside a git project; nothing otherwise. */
const projectLabel = (info: { cwd?: string; branch?: unknown } | null) => {
  if (!info?.cwd || typeof info.branch !== "string" || !info.branch) return "";
  const name = info.cwd.replace(/\/+$/, "").split("/").pop();
  return name ? `${name} (${info.branch})` : "";
};

const back = () => (router.canGoBack() ? router.back() : router.replace("/"));

export function ChatScreen({
  storedId,
  profile,
  canonical,
}: {
  storedId?: string;
  profile: string;
  canonical?: boolean;
}) {
  const styles = useStyles();
  const { profiles, setActiveBot, refreshSessions, showToast } = useGateway();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState("");
  const [switcher, setSwitcher] = useState(false);
  const [settings, setSettings] = useState(false);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [screenOpen, setScreenOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  // The next send edits a message (rewind) or asks a side question about a reply.
  const [mode, setMode] = useState<{ kind: "edit"; item: UserItem } | { kind: "about"; quote: string } | null>(null);
  const chat = useChatSession({
    storedId,
    profile,
    canonical,
    onCreated: () => refreshSessions(),
  });
  const { state } = chat;
  const hasSession = Boolean(chat.storedId ?? storedId);
  const control = useSessionControl({ rpc: chat.sessionRpc, liveSessionId: chat.liveSessionId, enabled: hasSession });
  // Coming back to this chat (from another screen or the desktop): catch up. The first focus is
  // skipped: opening already loaded the transcript, and a second load right away is wasted work.
  const { sync } = chat;
  const focusedBefore = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (focusedBefore.current) void sync();
      focusedBefore.current = true;
    }, [sync]),
  );
  const bot = findBot(profiles, profile);
  const name = botTitle(bot, profile);
  const liveId = chat.storedId ?? storedId;
  const { attachImage, attachFile } = chat;
  const shareAttach = useMemo(() => ({ image: attachImage, file: attachFile }), [attachImage, attachFile]);
  useSharedDraft(profile, !storedId && !canonical, setDraft, shareAttach);
  useTurnActivity({
    running: state.running,
    status: state.statusLine,
    bot: name,
    profile,
    url: canonical ? `hermes://bot/${encodeURIComponent(profile)}` : liveId ? `hermes://chat/${encodeURIComponent(liveId)}?profile=${encodeURIComponent(profile)}` : "hermes://",
  });
  const data = useMemo(() => [...state.items].reverse(), [state.items]);
  const matches = useMemo(() => (searchOpen ? searchTimeline(data, searchQuery) : []), [data, searchOpen, searchQuery]);
  const focusId = matches.length ? matches[Math.min(matchIndex, matches.length - 1)] : null;
  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQuery("");
    setMatchIndex(0);
  };
  const latestReplyText = useMemo(() => {
    const reply = data.find((item) => item.kind === "assistant");
    return reply?.kind === "assistant" ? reply.text : "";
  }, [data]);
  const signInAsked = !state.running && asksForSignIn(latestReplyText);
  const browser = useChatBrowser({
    storedId: chat.storedId ?? storedId,
    liveId: chat.liveSessionId,
    running: state.running,
    signInAsked,
  });
  const finishScreen = () => {
    setScreenOpen(false);
    if (browser.handoff) return void browser.finish(browser.handoff, "done");
    void chat.send("I've finished in your browser (signed in). Please continue where you left off.");
  };
  const latestReplyId = useMemo(
    () => data.find((item) => item.kind === "assistant")?.id,
    [data],
  );
  // Files bots shared in this chat that live on the Hermes machine, newest first, for re-attaching.
  const recentFiles = useMemo(() => {
    const seen = new Set<string>();
    const out: { name: string; path: string }[] = [];
    for (const item of data) {
      if (item.kind !== "assistant") continue;
      for (const file of item.files ?? []) {
        if (!file.path || seen.has(file.path)) continue;
        seen.add(file.path);
        out.push({ name: file.name, path: file.path });
      }
    }
    return out.slice(0, 30);
  }, [data]);
  const subagents = useMemo(
    () => Object.values(state.subagents),
    [state.subagents],
  );

  const retryFor = useCallback(
    (item: TimelineItem) => {
      if (item.kind !== "assistant" || item.status !== "error")
        return undefined;
      const index = state.items.indexOf(item);
      const prior = state.items
        .slice(0, index)
        .reverse()
        .find((entry) => entry.kind === "user");
      return prior && prior.kind === "user"
        ? () => chat.send(prior.text)
        : undefined;
    },
    [chat, state.items],
  );

  // Switching bots opens that bot's conversation (or a fresh session if this was one).
  const switchBot = (next: string) => {
    if (next === profile) return;
    setActiveBot(next);
    if (canonical) botConversation(next);
    else newChat(next);
  };

  const voice = useVoice(profile);
  const { speak, speakingId } = voice;
  const actions = useMemo(
    () => ({
      onEdit: state.running
        ? undefined
        : (item: UserItem) => {
            setMode({ kind: "edit", item });
            setDraft(item.text);
          },
      onAskAbout: (text: string) => {
        setMode({ kind: "about", quote: text });
        setDraft("");
      },
      onSpeak: (id: string, text: string) => void speak(id, text),
      speakingId,
    }),
    [speak, speakingId, state.running],
  );
  const { edit, askAside, send } = chat;
  const onSend = useCallback(
    (text: string) => {
      if (!mode) return send(text);
      setMode(null);
      if (mode.kind === "edit") return void edit(mode.item, text);
      const excerpt = mode.quote.length > 1200 ? `${mode.quote.slice(0, 1200)}…` : mode.quote;
      askAside(`About this reply of yours:\n"""\n${excerpt}\n"""\n\n${text}`, "btw", text);
      return undefined;
    },
    [askAside, edit, mode, send],
  );
  const banner = mode
    ? mode.kind === "edit"
      ? { icon: "create-outline" as const, label: "Editing. Later messages will be replaced.", onCancel: () => setMode(null) }
      : {
          icon: "chatbubbles-outline" as const,
          label: `Ask about: ${mode.quote.replace(/\s+/g, " ").slice(0, 80)}`,
          onCancel: () => setMode(null),
        }
    : null;

  const hasMessages = state.items.length > 0;
  const newChatHere = useCallback(() => newChat(profile), [profile]);
  const scopeSession = chat.storedId ?? storedId ?? null;
  const scope = useMemo(
    () => ({ profile, sessionId: scopeSession }),
    [profile, scopeSession],
  );

  return (
    <ChatScope.Provider value={scope}>
      <MessageActionsContext.Provider value={actions}>
      <View style={styles.root}>
        <ChatHeader
          botName={name}
          botId={profile}
          subtitle={[
            canonical ? String(state.info?.model || bot?.model || "Bot chat") : `Session · ${String(state.info?.model || bot?.model || "Hermes")}`,
            projectLabel(state.info),
          ]
            .filter(Boolean)
            .join(" · ")}
          running={state.running}
          contextPercent={state.usage?.context_percent}
          onBack={back}
          onSwitchBot={() => setSwitcher(true)}
          onNewChat={() => newChat(profile)}
          onSettings={
            hasMessages || storedId ? () => setSettings(true) : undefined
          }
        />
        {searchOpen ? (
          <ChatSearchBar
            query={searchQuery}
            onQuery={(text) => {
              setSearchQuery(text);
              setMatchIndex(0);
            }}
            index={Math.min(matchIndex, Math.max(0, matches.length - 1))}
            count={matches.length}
            onStep={(direction) =>
              matches.length && setMatchIndex((current) => (current + direction + matches.length) % matches.length)
            }
            onClose={closeSearch}
          />
        ) : null}
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          {chat.loading && !hasMessages ? (
            <ChatSkeleton />
          ) : hasMessages ? (
            <ChatList
              data={data}
              focusId={focusId}
              renderItem={({ item }) => (
                <View style={item.id === focusId ? styles.found : undefined}>
                <MessageItem
                  item={item}
                  statusLine={
                    item.kind === "assistant" && item.streaming
                      ? state.statusLine
                      : undefined
                  }
                  onRetry={retryFor(item)}
                  onNewChat={newChatHere}
                  latest={item.id === latestReplyId}
                />
                </View>
              )}
            />
          ) : (
            <HomeHero bot={bot} onPrompt={setDraft} />
          )}
          <LiveActivity
            subagents={subagents}
            todos={state.todos}
            running={state.running}
            onOpenAgent={(agent) => setAgentId(agent.id)}
          />
          <ControlCard control={control.control} onAction={control.act} />
          {browser.installed && browser.task ? (
            <Animated.View entering={CARD_IN} exiting={CARD_OUT}>
              <BrowserShareCard
                botName={name}
                handoff={browser.handoff}
                browserOpen={Boolean(browser.task)}
                signInAsked={signInAsked}
                onOpen={() => setScreenOpen(true)}
              />
            </Animated.View>
          ) : null}
          {state.requests.map((request) => (
            <Animated.View
              key={request.id}
              entering={CARD_IN}
              exiting={CARD_OUT}
            >
              <RequestCard
                request={request}
                botName={name}
                onAnswer={chat.answer}
                onDecline={chat.decline}
              />
            </Animated.View>
          ))}
          <View style={{ paddingBottom: Math.max(insets.bottom, space.sm) }}>
            {voiceMode ? (
              <VoicePanel
                profile={profile}
                botName={name}
                items={state.items}
                running={state.running}
                statusLine={state.statusLine}
                send={chat.send}
                interrupt={chat.interrupt}
                onClose={() => setVoiceMode(false)}
              />
            ) : (
              <Composer
                botName={name}
                running={state.running}
                info={state.info}
                attachments={chat.attachments}
                draft={draft}
                setDraft={setDraft}
                onSend={onSend}
                banner={banner}
                voice={voice}
                onStop={chat.interrupt}
                onAttachImage={chat.attachImage}
                onAttachFile={chat.attachFile}
                recentFiles={recentFiles}
                onRemoveAttachment={chat.removeAttachment}
                onAside={chat.askAside}
                onConfigure={chat.configure}
                profile={profile}
                onVoiceMode={() => {
                  voice.stopSpeaking();
                  setVoiceMode(true);
                }}
              />
            )}
          </View>
        </KeyboardAvoidingView>

        <BrowserViewer
          visible={screenOpen}
          task={browser.task}
          botName={name}
          onDone={finishScreen}
          onClose={() => setScreenOpen(false)}
        />
        <SubagentSheet
          agent={agentId ? (state.subagents[agentId] ?? null) : null}
          onClose={() => setAgentId(null)}
          rpc={chat.sessionRpc}
        />
        <BotSwitcher
          visible={switcher}
          onClose={() => setSwitcher(false)}
          onPick={switchBot}
        />
        <SessionSheet
          visible={settings}
          onClose={() => setSettings(false)}
          profile={profile}
          title={state.title}
          info={state.info}
          usage={state.usage}
          canDelete={!canonical && Boolean(chat.storedId ?? storedId)}
          storedId={chat.storedId ?? storedId}
          onSearch={() => {
            setSettings(false);
            setSearchOpen(true);
          }}
          onRename={chat.rename}
          onModel={(model, provider) =>
            chat.configure("model", `${model} --provider ${provider}`)
          }
          onYolo={(on) => chat.configure("yolo", on ? "on" : "off")}
          onCompress={() => {
            setSettings(false);
            chat.compress();
          }}
          onDelete={async () => {
            setSettings(false);
            try {
              await chat.remove();
              refreshSessions();
              back();
            } catch (error) {
              showToast(errorText(error, "Could not delete chat"), "error");
            }
          }}
        />
      </View>
      </MessageActionsContext.Provider>
    </ChatScope.Provider>
  );
}

const useStyles = makeStyles((colors, type) => ({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { paddingHorizontal: space.lg, paddingVertical: space.md },
  found: { backgroundColor: colors.raised, borderRadius: 12, marginHorizontal: -space.sm, paddingHorizontal: space.sm },
}));
