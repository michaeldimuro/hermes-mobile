import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { AppState } from "react-native";
import { errorText, useGateway } from "@/lib/store/GatewayProvider";
import type { SessionOpenResult, TranscriptMessage } from "@/lib/gateway/types";
import { haptic } from "@/ui/primitives";
import { markSessionRead, useAsideQuestions, useChatAttachments, useChatSettings, useSlashRunner, useTranscriptCache } from "./useChatTools";
import { parseSlash } from "./composerText";
import { mentionNote, resolveMentions } from "./mentions";
import { chatReducer, initialChatState, UserItem } from "./chatReducer";


export type Attachment = {
  id: string;
  uri: string;
  name: string;
  path?: string;
  /** Non-image files are staged into the session workspace and referenced as `@file:` in the prompt. */
  kind?: "image" | "file";
  ref?: string;
};

type Options = {
  /** Stored session id to resume; omitted for a brand-new chat. */
  storedId?: string;
  profile: string;
  /**
   * The bot's continuous "Bot Chat" (Hermes Bot Mode): found by its title or created on first send,
   * exactly as Hermes desktop does. Only these sessions get the `message_agent` teammate tool.
   */
  canonical?: boolean;
  /** Called once a new chat gets its stored id (so the route can reflect it). */
  onCreated?: (storedId: string) => void;
};

const isMissingSession = (error: unknown) =>
  /session (not found|unknown)|no such session|4001/i.test(
    errorText(error, ""),
  );

export const BOT_CHAT_TITLE = "Bot Chat";

export function useChatSession({
  storedId,
  profile,
  canonical,
  onCreated,
}: Options) {
  const { client, call, connection, profiles, get } = useGateway();
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const [loading, setLoading] = useState(Boolean(storedId));
  const runtimeId = useRef<string | null>(null);
  const stored = useRef<string | null>(storedId ?? null);
  const opening = useRef<Promise<string> | null>(null);
  const [currentStoredId, setCurrentStoredId] = useState<string | null>(
    storedId ?? null,
  );
  // Offline copy of the transcript: shown at once on open, replaced when Hermes answers.
  const { remember, markHydrated } = useTranscriptCache(
    canonical ? `bot-${profile}` : storedId ? `chat-${profile}-${storedId}` : null,
    dispatch,
  );

  const onCreatedRef = useRef(onCreated);
  useEffect(() => {
    onCreatedRef.current = onCreated;
  }, [onCreated]);

  const bind = useCallback(
    (result: SessionOpenResult) => {
      if (runtimeId.current && runtimeId.current !== result.session_id)
        client?.untrack(runtimeId.current);
      runtimeId.current = result.session_id;
      stored.current =
        result.stored_session_id ?? stored.current ?? result.session_id;
      setCurrentStoredId(stored.current);
      client?.track(result.session_id);
      return result.session_id;
    },
    [client],
  );

  const resume = useCallback(
    async (id: string) => {
      const result = await call<SessionOpenResult>(
        "session.resume",
        { session_id: id, profile, eager_build: true, source: "mobile" },
        60_000,
      );
      markHydrated();
      markSessionRead(get, result.stored_session_id ?? id, profile);
      remember(result.messages ?? []);
      dispatch({
        type: "hydrate",
        messages: result.messages ?? [],
        info: result.info,
        running: Boolean(result.running ?? result.info?.running),
        inflight: result.inflight?.assistant,
      });
      const runtime = bind(result);
      // Questions still waiting from before (approval, clarify…) arrive with the resume result,
      // before this session id was known to the live request filter — surface them here.
      for (const request of result.open_requests ?? [])
        dispatch({ type: "request.add", request });
      return runtime;
    },
    [bind, call, get, markHydrated, profile, remember],
  );

  /** Resolve the live runtime session, creating or resuming it on demand. */
  const ensureSession = useCallback(async () => {
    if (runtimeId.current) return runtimeId.current;
    if (opening.current) return opening.current;
    opening.current = (async () => {
      if (stored.current) return resume(stored.current);
      if (canonical) {
        const found = await call<{
          sessions?: {
            id: string;
            resolved_id?: string | null;
            title?: string;
          }[];
        }>("session.list", {
          profile,
          title: BOT_CHAT_TITLE,
          include_hidden: true,
          limit: 5,
        });
        const row = found.sessions?.find(
          (session) => session.title === BOT_CHAT_TITLE,
        );
        if (row) {
          stored.current = row.resolved_id || row.id;
          return resume(stored.current);
        }
      }
      const created = await call<SessionOpenResult>(
        "session.create",
        canonical
          ? {
              profile,
              source: "mobile",
              title: BOT_CHAT_TITLE,
              hidden: true,
              follow_profile_config: true,
            }
          : { profile, source: "mobile" },
        60_000,
      );
      if (canonical)
        // Persist the row now so the title (the canonical marker) exists before the first turn.
        await call("session.title", {
          session_id: created.session_id,
          profile,
          title: BOT_CHAT_TITLE,
        }).catch(() => undefined);
      const id = bind(created);
      if (created.info)
        dispatch({
          type: "event",
          event: { type: "session.info", payload: created.info },
        });
      if (stored.current) onCreatedRef.current?.(stored.current);
      return id;
    })().finally(() => {
      opening.current = null;
    });
    return opening.current;
  }, [bind, call, canonical, profile, resume]);

  // Callers key this hook's component by (profile, storedId), so a new conversation always gets
  // fresh state; the effect below only attaches it to the live gateway.

  // Attach on first open and re-attach after every reconnect: Hermes routes a session's events to
  // the socket that last resumed it, so a new socket must resume to keep receiving the stream.
  useEffect(() => {
    if (connection !== "open") {
      runtimeId.current = null;
      return;
    }
    if (!stored.current || runtimeId.current || opening.current) return;
    let active = true;
    const id = stored.current;
    opening.current = resume(id).finally(() => {
      opening.current = null;
    });
    opening.current
      .catch(
        (error) =>
          active &&
          dispatch({
            type: "notice",
            text: errorText(error, "Could not open this chat"),
            level: "error",
          }),
      )
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [connection, storedId, profile, resume]);

  /** A turn this phone sent is in flight; turns started elsewhere (e.g. Hermes desktop) are not. */
  const localTurn = useRef(false);
  const remoteTurn = useRef(false);
  /** A message was sent but Hermes didn't report its stored row yet: re-sync when the turn ends. */
  const unstamped = useRef(false);
  const syncing = useRef<Promise<void> | null>(null);

  /** Pull the stored transcript so messages posted from another client show up here too. */
  const sync = useCallback(() => {
    const sid = runtimeId.current;
    if (!sid || syncing.current) return syncing.current ?? Promise.resolve();
    syncing.current = call<{ messages?: TranscriptMessage[] }>("session.history", { session_id: sid, profile })
      .then((result) => {
        if (runtimeId.current === sid && result.messages) {
          remember(result.messages);
          dispatch({ type: "reconcile", messages: result.messages });
        }
      })
      .catch(() => undefined)
      .finally(() => {
        syncing.current = null;
      });
    return syncing.current;
  }, [call, profile, remember]);
  const syncRef = useRef(sync);
  const getRef = useRef(get);
  useEffect(() => {
    getRef.current = get;
  }, [get]);
  useEffect(() => {
    syncRef.current = sync;
  }, [sync]);

  // Back from the background: the desktop may have continued this conversation meanwhile.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") void syncRef.current();
    });
    return () => sub.remove();
  }, []);

  // Live events + questions from the agent for this session only.
  useEffect(() => {
    if (!client) return;
    const offEvent = client.onEvent((event) => {
      if (event.session_id && event.session_id === runtimeId.current) {
        dispatch({ type: "event", event, now: Date.now() });
        if (event.type === "message.start") {
          // Started by another client: fetch the prompt they sent (there is no user-message event).
          remoteTurn.current = !localTurn.current;
          localTurn.current = false;
          if (remoteTurn.current) void syncRef.current();
        }
        if (event.type === "message.complete") {
          haptic.tap();
          if (stored.current && AppState.currentState === "active") markSessionRead(getRef.current, stored.current, profile);
          if (remoteTurn.current || unstamped.current) {
            remoteTurn.current = false;
            unstamped.current = false;
            void syncRef.current();
          }
        }
      }
      if (
        event.type === "session.reclaimed" &&
        event.payload?.session_id === runtimeId.current
      ) {
        runtimeId.current = null; // next action resumes transparently
      }
    });
    const offRequest = client.onRequest((request) => {
      if (
        request.params?.session_id &&
        request.params.session_id === runtimeId.current
      ) {
        haptic.warn();
        dispatch({ type: "request.add", request });
      }
    });
    return () => {
      offEvent();
      offRequest();
    };
  }, [client, profile]);

  const withSession = useCallback(
    async <T>(action: (sessionId: string) => Promise<T>): Promise<T> => {
      const id = await ensureSession();
      try {
        return await action(id);
      } catch (error) {
        if (!isMissingSession(error)) throw error;
        runtimeId.current = null;
        return action(await ensureSession());
      }
    },
    [ensureSession],
  );

  const { attachments, setAttachments, attachImage, attachFile, removeAttachment } = useChatAttachments({
    call,
    profile,
    withSession,
    dispatch,
    runtimeId,
  });
  const { configure, rename, compress } = useChatSettings({ call, profile, withSession, dispatch });
  const askAside = useAsideQuestions({ call, profile, withSession, dispatch });

  const runSlash = useSlashRunner({ call, profile, withSession, dispatch });

  const send = useCallback(
    async (raw: string): Promise<string | undefined> => {
      const text = raw.trim();
      if (!text) return undefined;
      const images = attachments.filter((a) => a.kind !== "file").map((attachment) => attachment.uri);
      const files = attachments.filter((a) => a.kind === "file");
      haptic.press();
      try {
        // Attach first: a resume hydrates the transcript and would drop an optimistic bubble.
        await ensureSession();
      } catch (error) {
        dispatch({
          type: "notice",
          text: errorText(error, "Could not reach Hermes"),
          level: "error",
        });
        return undefined;
      }
      const id = `u-local-${Date.now()}`;
      dispatch({
        type: "user",
        id,
        text,
        images: images.length ? images : undefined,
        files: files.length ? files.map((file) => file.name) : undefined,
        at: Date.now(),
      });
      localTurn.current = true;
      setAttachments([]);
      try {
        if (parseSlash(text)) return await runSlash(text);
        // @mentions: tell the bot who is meant (desktop Bot Mode note); the bubble keeps the typed text.
        const refs = files.map((file) => file.ref).filter(Boolean).join(" ");
        const prompt = text + (refs ? `\n\n${refs}` : "") + mentionNote(resolveMentions(text, profiles));
        const result = await withSession((session_id) =>
          call<{ user_row_id?: number | null }>("prompt.submit", { session_id, text: prompt, profile }),
        );
        if (typeof result?.user_row_id === "number") dispatch({ type: "stamp", id, rowId: result.user_row_id });
        else unstamped.current = true;
      } catch (error) {
        dispatch({
          type: "event",
          event: {
            type: "error",
            payload: { message: errorText(error, "Message failed") },
          },
        });
      }
      return undefined;
    },
    [
      attachments,
      setAttachments,
      call,
      ensureSession,
      profile,
      profiles,
      runSlash,
      withSession,
    ],
  );

  /**
   * Edit & resend: Hermes rewinds the stored conversation to just before `item` (by its durable
   * row) and runs `text` as the new turn. Everything after that message is dropped on every device.
   */
  const edit = useCallback(
    async (item: UserItem, raw: string) => {
      const text = raw.trim();
      if (!text) return;
      if (typeof item.rowId !== "number") {
        dispatch({ type: "notice", text: "This message isn't saved yet. Try again in a moment.", level: "warn" });
        void sync();
        return;
      }
      const id = `u-local-${Date.now()}`;
      haptic.press();
      dispatch({ type: "rewind", fromId: item.id, text, id, at: Date.now() });
      localTurn.current = true;
      try {
        const prompt = text + mentionNote(resolveMentions(text, profiles));
        const result = await withSession((session_id) =>
          call<{ user_row_id?: number | null }>("prompt.submit", {
            session_id,
            profile,
            text: prompt,
            truncate_before_row_id: item.rowId,
            confirm_truncate: true,
          }),
        );
        if (typeof result?.user_row_id === "number") dispatch({ type: "stamp", id, rowId: result.user_row_id });
        else unstamped.current = true;
      } catch (error) {
        dispatch({ type: "settle" });
        dispatch({ type: "notice", text: errorText(error, "Could not edit that message"), level: "error" });
        void sync();
      }
    },
    [call, profile, profiles, sync, withSession],
  );

  const interrupt = useCallback(async () => {
    if (!runtimeId.current) return;
    haptic.press();
    try {
      await call("session.interrupt", {
        session_id: runtimeId.current,
        profile,
      });
    } catch (error) {
      dispatch({
        type: "notice",
        text: errorText(error, "Could not stop"),
        level: "error",
      });
    }
  }, [call, profile]);

  /** Session-scoped call (sub-agent controls, goal / loop controls): fills in session_id + profile. */
  const sessionRpc = useCallback(
    <T,>(method: string, params: Record<string, unknown>) =>
      withSession((session_id) => call<T>(method, { ...params, session_id, profile })),
    [call, profile, withSession],
  );

  const liveSessionId = useCallback(() => runtimeId.current, []);

  const answer = useCallback(
    (id: string, result: Record<string, unknown>) => {
      client?.respond(id, result);
      dispatch({ type: "request.resolve", id });
      haptic.success();
    },
    [client],
  );

  const decline = useCallback(
    (id: string) => {
      client?.decline(id);
      dispatch({ type: "request.resolve", id });
    },
    [client],
  );

  /** Close the live session (Hermes refuses to delete an active one), then delete it. */
  const remove = useCallback(async () => {
    const id = stored.current;
    if (!id) return;
    if (runtimeId.current) {
      await call("session.close", { session_id: runtimeId.current }).catch(
        () => undefined,
      );
      client?.untrack(runtimeId.current);
      runtimeId.current = null;
    }
    await call("session.delete", { session_id: id, profile });
  }, [call, client, profile]);

  return {
    state,
    sync,
    rename,
    remove,
    compress,
    loading,
    attachments,
    storedId: currentStoredId,
    send,
    edit,
    attachImage,
    attachFile,
    removeAttachment,
    interrupt,
    askAside,
    sessionRpc,
    liveSessionId,
    answer,
    decline,
    configure,
  };
}
