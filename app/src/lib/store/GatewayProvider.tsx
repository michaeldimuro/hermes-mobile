import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";
import { clearCache, readCache, writeCache } from "./offlineCache";
import { secureStorage } from "./secureStorage";
import { GatewayClient } from "@/lib/gateway/client";
import { GatewayAuthError, normalizeGatewayUrl, passwordLogin, rest } from "@/lib/gateway/rest";
import type {
  ConnectionState,
  GatewayConfig,
  GatewayEvent,
  ProfileRow,
  SessionListRow,
} from "@/lib/gateway/types";

const CONFIG_KEY = "hermes.gateway";
const ACTIVE_BOT_KEY = "hermes.activeBot";

/** Server requests the phone cannot fulfil (desktop panes, native windows) are declined at once
 *  so the agent never stalls waiting for them. */
const UNSUPPORTED_REQUESTS = new Set([
  "preview.act",
  "preview.read",
  "terminal.read",
  "window.read",
  "tour",
  "display.install.sudo",
]);

export type Toast = { id: number; text: string; level: "info" | "warn" | "error" | "success" };

/** Why the realtime link is down, once we know (null while connected or still trying for the first time). */
export type ConnectionIssue = { kind: "unreachable" | "realtime"; message: string } | null;

/** Credentials for `connect`: the dashboard token, or a username/password sign-in. */
export type Credentials = { token: string } | { username: string; password: string };

const PASSWORD_REJECTED =
  "Hermes no longer accepts the saved username and password. Sign in again to reconnect.";

const TOKEN_EXPIRED =
  "Hermes rejected the saved session token (it changes whenever Hermes restarts). Paste the current token to reconnect.";

type GatewayContextValue = {
  loaded: boolean;
  config: GatewayConfig | null;
  client: GatewayClient | null;
  connection: ConnectionState;
  connectionIssue: ConnectionIssue;
  /** Shown on the connect screen after an automatic sign-out (e.g. expired token). */
  authNotice: string | null;
  /** Last gateway URL used, kept after sign-out to prefill the connect screen. */
  lastUrl: string;
  /** Reconnect now instead of waiting for backoff. */
  retry: () => void;
  profiles: ProfileRow[];
  activeBot: string;
  sessions: SessionListRow[];
  /** False until the first session list for the active bot has arrived. */
  sessionsLoaded: boolean;
  toast: Toast | null;
  connect: (url: string, credentials: Credentials) => Promise<void>;
  disconnect: () => Promise<void>;
  call: <T>(method: string, params?: Record<string, unknown>, timeoutMs?: number) => Promise<T>;
  get: <T>(path: string, init?: RequestInit) => Promise<T>;
  setActiveBot: (name: string) => void;
  refreshProfiles: () => Promise<void>;
  refreshSessions: () => Promise<void>;
  showToast: (text: string, level?: Toast["level"]) => void;
  dismissToast: () => void;
};

const GatewayContext = createContext<GatewayContextValue | null>(null);

export function useGateway() {
  const value = useContext(GatewayContext);
  if (!value) throw new Error("useGateway must be used inside GatewayProvider");
  return value;
}

export const errorText = (error: unknown, fallback = "Something went wrong.") =>
  error instanceof Error && error.message ? error.message : fallback;

export function GatewayProvider({ children }: { children: ReactNode }) {
  const [loaded, setLoaded] = useState(false);
  const [config, setConfig] = useState<GatewayConfig | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("idle");
  const [connectionIssue, setConnectionIssue] = useState<ConnectionIssue>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [lastUrl, setLastUrl] = useState("");
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [activeBot, setActiveBotState] = useState("default");
  const [sessions, setSessions] = useState<SessionListRow[]>([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((text: string, level: Toast["level"] = "info") => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), text, level });
    toastTimer.current = setTimeout(() => setToast(null), level === "error" ? 5000 : 3000);
  }, []);
  const dismissToast = useCallback(() => setToast(null), []);

  useEffect(() => {
    (async () => {
      try {
        const [saved, bot, cachedProfiles] = await Promise.all([
          secureStorage.get(CONFIG_KEY),
          secureStorage.get(ACTIVE_BOT_KEY),
          readCache<ProfileRow[]>("profiles"),
        ]);
        if (bot) setActiveBotState(bot);
        // Last known bots: the inbox renders before (or without) a connection, then refreshes.
        if (saved && cachedProfiles?.length) setProfiles((current) => (current.length ? current : cachedProfiles));
        if (saved) {
          const parsed = JSON.parse(saved) as GatewayConfig;
          if (parsed.url) setLastUrl(normalizeGatewayUrl(parsed.url));
          const url = normalizeGatewayUrl(parsed.url ?? "");
          if (parsed.url && parsed.auth === "password" && parsed.username && parsed.password)
            setConfig({ url, auth: "password", username: parsed.username, password: parsed.password });
          else if (parsed.url && parsed.auth !== "password" && parsed.token) setConfig({ url, auth: "token", token: parsed.token });
        }
      } catch {
        await secureStorage.remove(CONFIG_KEY).catch(() => undefined);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  // Latest callbacks for the socket subscription below (refreshed after every render).
  const refreshers = useRef<{
    profiles: () => void;
    sessions: () => void;
    diagnose: () => void;
    setBot?: (name: string) => void;
  } | null>(null);
  const activeBotRef = useRef("default");

  // One realtime client per gateway config; the effect only starts and stops it.
  const client = useMemo(() => (config ? new GatewayClient(config) : null), [config]);
  useEffect(() => {
    if (!client) return;
    const offState = client.onState((state) => {
      setConnection(state);
      if (state === "open") {
        // Fresh data on every (re)connect.
        setConnectionIssue(null);
        refreshers.current?.profiles();
        refreshers.current?.sessions();
      } else if (state === "reconnecting") {
        // The socket can't tell a dead token from a dead network; the REST API can.
        refreshers.current?.diagnose();
      }
    });
    const offRequest = client.onRequest((request) => {
      if (UNSUPPORTED_REQUESTS.has(request.method)) client.decline(request.id, "Not available on mobile");
    });
    client.start();
    return () => {
      offState();
      offRequest();
      client.stop();
    };
  }, [client]);

  const signOut = useCallback(async (message?: string) => {
    await secureStorage.remove(CONFIG_KEY).catch(() => undefined);
    await clearCache();
    setConfig(null);
    setProfiles([]);
    setSessions([]);
    setSessionsLoaded(false);
    setConnectionIssue(null);
    setAuthNotice(message ?? null);
  }, []);

  /** Classify a connection failure: expired token → sign out; otherwise say what is unreachable. */
  const lastDiagnosis = useRef(0);
  const diagnose = useCallback(async () => {
    if (!config || Date.now() - lastDiagnosis.current < 10_000) return;
    lastDiagnosis.current = Date.now();
    const host = config.url.replace(/^https?:\/\//i, "");
    try {
      await rest(config, "/api/profiles", {}, 8_000);
      // REST works, so the token is fine: only the WebSocket upgrade is failing (proxy/tunnel config).
      if (client?.state !== "open")
        setConnectionIssue({ kind: "realtime", message: `${host} answers, but its live connection (WebSocket) is blocked. Check your tunnel or proxy allows WebSockets.` });
    } catch (error) {
      if (error instanceof GatewayAuthError) return signOut(config.auth === "password" ? PASSWORD_REJECTED : TOKEN_EXPIRED);
      if (client?.state !== "open") setConnectionIssue({ kind: "unreachable", message: `Can't reach Hermes at ${host}.` });
    }
  }, [client, config, signOut]);

  const retry = useCallback(() => {
    lastDiagnosis.current = 0;
    client?.retryNow();
  }, [client]);

  const call = useCallback(
    <T,>(method: string, params: Record<string, unknown> = {}, timeoutMs?: number) => {
      if (!client) return Promise.reject(new Error("Not connected to Hermes"));
      return client.request<T>(method, params, timeoutMs);
    },
    [client],
  );

  const get = useCallback(
    async <T,>(path: string, init?: RequestInit) => {
      if (!config) throw new Error("Not connected to Hermes");
      try {
        return await rest<T>(config, path, init);
      } catch (error) {
        if (error instanceof GatewayAuthError) await signOut(error.message);
        throw error;
      }
    },
    [config, signOut],
  );

  const refreshProfiles = useCallback(async () => {
    if (!client) return;
    try {
      const result = await client.request<{ profiles?: ProfileRow[] }>("profiles.list", { include_sessions: true });
      const list = result.profiles ?? [];
      setProfiles(list);
      void writeCache("profiles", list);
      // A remembered bot may have been deleted or renamed since: fall back instead of failing every call.
      const bot = activeBotRef.current;
      if (list.length && !list.some((profile) => profile.name === bot)) {
        const fallback = list.find((profile) => profile.is_default)?.name ?? list[0].name;
        refreshers.current?.setBot?.(fallback);
      }
    } catch (error) {
      showToast(errorText(error, "Could not load bots"), "error");
    }
  }, [client, showToast]);

  /** Latest bot whose history was requested: stale responses for a previous bot are dropped. */
  const sessionsFor = useRef(activeBot);
  const loadSessions = useCallback(
    async (bot: string) => {
      if (!config) return;
      sessionsFor.current = bot;
      try {
        const query = `limit=60&offset=0&min_messages=1&archived=exclude&order=recent&profile=${encodeURIComponent(bot)}`;
        const result = await get<{ sessions?: SessionListRow[] }>(`/api/sessions?${query}`);
        if (sessionsFor.current !== bot) return;
        setSessions(result.sessions ?? []);
        setSessionsLoaded(true);
      } catch {
        // Keep the last good list; the connection banner explains outages.
      }
    },
    [config, get],
  );
  const refreshSessions = useCallback(() => loadSessions(activeBot), [loadSessions, activeBot]);

  const setActiveBot = useCallback(
    (name: string) => {
      setActiveBotState(name);
      setSessionsLoaded(false);
      setSessions([]);
      secureStorage.set(ACTIVE_BOT_KEY, name).catch(() => undefined);
      loadSessions(name);
    },
    [loadSessions],
  );

  useEffect(() => {
    refreshers.current = { profiles: refreshProfiles, sessions: refreshSessions, diagnose, setBot: setActiveBot };
    activeBotRef.current = activeBot;
  }, [refreshProfiles, refreshSessions, diagnose, setActiveBot, activeBot]);

  // Server push: keep lists live without polling.
  useEffect(() => {
    if (!client) return;
    return client.onEvent((event: GatewayEvent) => {
      if (event.type === "sessions.changed" || event.type === "session.title") {
        if (sessionsTimer.current) clearTimeout(sessionsTimer.current);
        // Bot rows carry each bot's latest conversation preview, so refresh the roster too.
        sessionsTimer.current = setTimeout(() => {
          refreshSessions();
          refreshProfiles();
        }, 400);
      } else if (event.type === "notification.show" && event.payload?.text) {
        const level = event.payload.level;
        showToast(String(event.payload.text), level === "error" || level === "warn" || level === "success" ? level : "info");
      }
    });
  }, [client, refreshProfiles, refreshSessions, showToast]);

  // Foreground: reconnect immediately instead of waiting for backoff, then refresh.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && client) {
        client.wake();
        refreshSessions();
      }
    });
    return () => sub.remove();
  }, [client, refreshSessions]);

  const connect = useCallback(async (url: string, credentials: Credentials) => {
    const base = normalizeGatewayUrl(url);
    const next: GatewayConfig =
      "token" in credentials
        ? { url: base, auth: "token", token: credentials.token.trim() }
        : { url: base, auth: "password", username: credentials.username.trim(), password: credentials.password };
    if (next.auth === "password") await passwordLogin(next);
    // /api/status is public; /api/profiles proves the credentials are accepted.
    await rest(next, "/api/profiles");
    await secureStorage.set(CONFIG_KEY, JSON.stringify(next));
    setLastUrl(next.url);
    setAuthNotice(null);
    setConfig(next);
  }, []);

  // Validate a remembered token right away rather than waiting for the socket to fail.
  useEffect(() => {
    if (loaded && config) refreshers.current?.diagnose();
  }, [loaded, config]);

  const disconnect = useCallback(() => signOut(), [signOut]);

  const value = useMemo<GatewayContextValue>(
    () => ({
      loaded,
      config,
      client,
      connection,
      connectionIssue,
      authNotice,
      lastUrl,
      retry,
      profiles,
      activeBot,
      sessions,
      sessionsLoaded,
      toast,
      connect,
      disconnect,
      call,
      get,
      setActiveBot,
      refreshProfiles,
      refreshSessions,
      showToast,
      dismissToast,
    }),
    [loaded, config, client, connection, connectionIssue, authNotice, lastUrl, retry, profiles, activeBot, sessions, sessionsLoaded, toast, connect, disconnect, call, get, setActiveBot, refreshProfiles, refreshSessions, showToast, dismissToast],
  );

  return <GatewayContext.Provider value={value}>{children}</GatewayContext.Provider>;
}
