import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject } from "react";
import { Alert } from "react-native";
import { errorText } from "@/lib/store/GatewayProvider";
import { RpcError } from "@/lib/gateway/client";
import type { TranscriptMessage } from "@/lib/gateway/types";
import { readCache, writeCache } from "@/lib/store/offlineCache";
import { haptic } from "@/ui/primitives";
import { ChatAction, ConfigKey, configPatch, ConfigSetResult } from "./chatReducer";
import { parseSlash } from "./composerText";
import type { Attachment } from "./useChatSession";

type Call = <T>(method: string, params?: Record<string, unknown>, timeoutMs?: number) => Promise<T>;
type WithSession = <T>(action: (sessionId: string) => Promise<T>) => Promise<T>;

type SlashResult = {
  type?: "exec" | "plugin" | "send" | "skill" | "prefill" | "alias" | string;
  output?: string;
  message?: string;
  notice?: string;
  warning?: string;
  target?: string;
  display?: string;
} | null;

type Deps = { call: Call; profile: string; withSession: WithSession; dispatch: Dispatch<ChatAction> };

/** Images and documents staged for the next message (companion to useChatSession). */
export function useChatAttachments({ call, profile, withSession, dispatch, runtimeId }: Deps & { runtimeId: RefObject<string | null> }) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  const attachImage = useCallback(
    async (image: {
      uri: string;
      base64: string;
      fileName?: string | null;
    }) => {
      const name = image.fileName || `photo-${Date.now()}.jpg`;
      try {
        const result = await withSession((session_id) =>
          call<{ attached: boolean; message?: string; path?: string | null }>(
            "image.attach_bytes",
            {
              session_id,
              profile,
              content_base64: image.base64,
              filename: name,
            },
            60_000,
          ),
        );
        if (!result.attached)
          throw new Error(result.message || "Image was not attached");
        setAttachments((current) => [
          ...current,
          {
            id: `${Date.now()}`,
            uri: image.uri,
            name,
            path: result.path ?? undefined,
          },
        ]);
      } catch (error) {
        dispatch({
          type: "notice",
          text: errorText(error, "Could not attach image"),
          level: "error",
        });
      }
    },
    [call, dispatch, profile, withSession],
  );

  /**
   * Stage a document for the bot: picked from the phone (`dataUrl`) or already on the Hermes
   * machine (`path`, e.g. a file a bot shared earlier). The prompt then references it as `@file:`.
   */
  const attachFile = useCallback(
    async (file: { name: string; dataUrl?: string; path?: string }) => {
      try {
        const result = await withSession((session_id) =>
          call<{ attached?: boolean; name?: string; path?: string; ref_text?: string }>(
            "file.attach",
            { session_id, profile, name: file.name, ...(file.dataUrl ? { data_url: file.dataUrl } : { path: file.path }) },
            120_000,
          ),
        );
        if (!result.ref_text) throw new Error("Hermes didn't accept the file");
        setAttachments((current) => [
          ...current,
          { id: `${Date.now()}`, uri: "", name: result.name || file.name, path: result.path, kind: "file", ref: result.ref_text },
        ]);
      } catch (error) {
        dispatch({ type: "notice", text: errorText(error, `Could not attach ${file.name}`), level: "error" });
      }
    },
    [call, dispatch, profile, withSession],
  );

  const removeAttachment = useCallback(
    async (attachment: Attachment) => {
      setAttachments((current) =>
        current.filter((item) => item.id !== attachment.id),
      );
      if (runtimeId.current && attachment.path && attachment.kind !== "file")
        call("image.detach", {
          session_id: runtimeId.current,
          profile,
          path: attachment.path,
        }).catch(() => undefined);
    },
    [call, profile, runtimeId],
  );

  return { attachments, setAttachments, attachImage, attachFile, removeAttachment };
}

/** Per-chat settings actions: model / reasoning / fast / YOLO, title, context compression. */
export function useChatSettings({ call, profile, withSession, dispatch }: Deps) {
  const configure = useCallback(
    (key: ConfigKey, value: string) => {
      const apply = async (confirmed: boolean): Promise<void> => {
        try {
          const result = await withSession((session_id) =>
            call<ConfigSetResult>(
              "config.set",
              {
                session_id,
                profile,
                key,
                value,
                ...(confirmed ? { confirm_expensive_model: true } : {}),
              },
              45_000,
            ),
          );
          if (result?.confirm_required) {
            Alert.alert(
              "Switch model?",
              result.confirm_message || "This model costs more to run.",
              [
                { text: "Cancel", style: "cancel" },
                { text: "Switch", onPress: () => void apply(true) },
              ],
            );
            return;
          }
          const patch = configPatch(key, value, result);
          if (patch)
            dispatch({
              type: "event",
              event: { type: "session.info", payload: patch },
            });
          haptic.tap();
        } catch (error) {
          dispatch({
            type: "notice",
            text: errorText(error, `Could not update ${key}`),
            level: "error",
          });
        }
      };
      return apply(false);
    },
    [call, dispatch, profile, withSession],
  );

  const rename = useCallback(
    async (title: string) => {
      try {
        await withSession((session_id) =>
          call("session.title", { session_id, profile, title }),
        );
        dispatch({
          type: "event",
          event: { type: "session.title", payload: { title } },
        });
      } catch (error) {
        dispatch({
          type: "notice",
          text: errorText(error, "Could not rename"),
          level: "error",
        });
      }
    },
    [call, dispatch, profile, withSession],
  );

  const compress = useCallback(async () => {
    try {
      dispatch({ type: "notice", text: "Compressing context…" });
      await withSession((session_id) =>
        call("session.compress", { session_id, profile }, 180_000),
      );
      dispatch({
        type: "notice",
        text: "Context compressed. The bot keeps a summary of earlier turns.",
      });
    } catch (error) {
      dispatch({
        type: "notice",
        text: errorText(error, "Could not compress"),
        level: "error",
      });
    }
  }, [call, dispatch, profile, withSession]);

  return { configure, rename, compress };
}

/** Runs `/commands` for a chat (companion to useChatSession). */
export function useSlashRunner({ call, profile, withSession, dispatch }: Deps) {
  /**
   * Run a `/command`. Built-ins answer through `slash.exec`; skills, quick commands and bundles
   * answer 4018 there and resolve through `command.dispatch` (same order as Hermes desktop).
   * Returns text to put back in the composer for `prefill` directives (e.g. /undo).
   */
  return useCallback(
    (command: string): Promise<string | undefined> => {
      const run = async (
        text: string,
        depth: number,
      ): Promise<string | undefined> => {
        const parsed = parseSlash(text);
        if (!parsed || depth > 2) return undefined;
        let result: SlashResult;
        try {
          result = await withSession((session_id) =>
            call<SlashResult>("slash.exec", {
              session_id,
              command: text,
              profile,
            }),
          );
        } catch (error) {
          if (!(error instanceof RpcError) || error.code !== 4018) throw error;
          result = await withSession((session_id) =>
            call<SlashResult>("command.dispatch", {
              session_id,
              name: parsed.name,
              arg: parsed.arg,
            }),
          );
        }
        if (result?.notice) dispatch({ type: "notice", text: result.notice });
        switch (result?.type) {
          case "skill":
          case "send":
            if (!result.message)
              throw new Error(`/${parsed.name} returned nothing to send`);
            await withSession((session_id) =>
              call("prompt.submit", {
                session_id,
                text: result.message,
                profile,
              }),
            );
            return undefined;
          case "prefill":
            dispatch({ type: "settle" });
            dispatch({
              type: "notice",
              text: "Draft restored to the composer.",
            });
            return result.message ?? "";
          case "alias":
            return result.target
              ? run(
                  `/${result.target}${parsed.arg ? ` ${parsed.arg}` : ""}`,
                  depth + 1,
                )
              : undefined;
          default: {
            const output = result?.output ?? result?.message ?? result?.warning;
            dispatch({
              type: "event",
              event: {
                type: "message.complete",
                payload: { text: output || "Done." },
              },
            });
            return undefined;
          }
        }
      };
      return run(command, 0);
    },
    [call, dispatch, profile, withSession],
  );
}

/** Messages kept per chat for offline reading. */
const CACHED_MESSAGES = 150;

/** Offline copy of a chat's transcript: hydrates at once on open until Hermes answers. */
export function useTranscriptCache(cacheKey: string | null, dispatch: Dispatch<ChatAction>) {
  const serverHydrated = useRef(false);
  useEffect(() => {
    if (!cacheKey) return;
    let alive = true;
    void readCache<TranscriptMessage[]>(cacheKey).then((messages) => {
      if (!alive || serverHydrated.current || !messages?.length) return;
      dispatch({ type: "hydrate", messages });
    });
    return () => {
      alive = false;
    };
  }, [cacheKey, dispatch]);
  const remember = useCallback(
    (messages: TranscriptMessage[]) => {
      if (cacheKey && messages.length) void writeCache(cacheKey, messages.slice(-CACHED_MESSAGES));
    },
    [cacheKey],
  );

  const markHydrated = useCallback(() => {
    serverHydrated.current = true;
  }, []);
  return { remember, markHydrated };
}

/** `/btw` side questions and background tasks for a chat. */
export function useAsideQuestions({ call, profile, withSession, dispatch }: Deps) {
  return useCallback(
    /** `shown` is what the side card displays when the sent text carries extra context. */
    async (question: string, mode: "btw" | "background", shown?: string) => {
      const localId = `side-${Date.now()}`;
      dispatch({ type: "side.start", mode, question: shown ?? question, localId });
      try {
        const result = await withSession((session_id) =>
          call<{ task_id: string }>(
            mode === "btw" ? "prompt.btw" : "prompt.background",
            { session_id, profile, text: question },
          ),
        );
        dispatch({ type: "side.task", localId, taskId: result.task_id });
      } catch (error) {
        dispatch({
          type: "notice",
          text: errorText(error, "Side task failed"),
          level: "error",
        });
      }
    },
    [call, dispatch, profile, withSession],
  );
}

/** Seen on this phone: clear Hermes's unread flag so the push relay and other devices know. */
export function markSessionRead(get: <T>(path: string, init?: RequestInit) => Promise<T>, sessionId: string, profile: string) {
  void get(`/api/sessions/${encodeURIComponent(sessionId)}?profile=${encodeURIComponent(profile)}`, {
    method: "PATCH",
    body: JSON.stringify({ unread: false }),
  }).catch(() => undefined);
}
