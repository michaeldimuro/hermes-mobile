/**
 * Subset of the Hermes `tui_gateway` wire contract used by the mobile client.
 * Source of truth: hermes-agent/apps/shared/src/gateway-contract.generated.ts
 */

/**
 * How the app authenticates to a Hermes backend:
 * - `token`: the dashboard session token (loopback / legacy backends; changes on every restart
 *   unless HERMES_DASHBOARD_SESSION_TOKEN is pinned).
 * - `password`: username/password sign-in (`hermes serve` with the basic auth provider) — a
 *   cookie session plus single-use WebSocket tickets; survives restarts with a stable secret.
 */
export type GatewayConfig =
  | { url: string; auth?: "token"; token: string }
  | { url: string; auth: "password"; username: string; password: string };

export type ConnectionState =
  | "idle"
  | "connecting"
  | "open"
  | "reconnecting"
  | "closed";

export interface Usage {
  model?: string;
  input?: number;
  output?: number;
  total?: number;
  calls?: number;
  context_used?: number | null;
  context_max?: number | null;
  context_percent?: number | null;
  avg_tps?: number | null;
  cost_usd?: number | null;
  [key: string]: unknown;
}

export interface SessionLiveInfo {
  model?: string;
  provider?: string;
  reasoning_effort?: string;
  fast?: boolean;
  yolo?: boolean;
  approval_mode?: string;
  cwd?: string;
  running?: boolean;
  title?: string;
  stored_session_id?: string;
  profile_name?: string | null;
  usage?: Usage | null;
  [key: string]: unknown;
}

export interface TranscriptMessage {
  role: string;
  text?: string | null;
  timestamp?: number | null;
  row_id?: number | null;
  name?: string | null;
  context?: string | null;
  args?: Record<string, unknown> | null;
  reasoning?: string | null;
  [key: string]: unknown;
}

export interface OpenRequestEntry {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export interface SessionOpenResult {
  session_id: string;
  stored_session_id?: string | null;
  messages?: TranscriptMessage[];
  info?: SessionLiveInfo;
  running?: boolean | null;
  open_requests?: OpenRequestEntry[] | null;
  inflight?: { assistant?: string; streaming?: boolean; user?: string } | null;
}

export interface SessionListRow {
  id: string;
  resolved_id?: string | null;
  title?: string;
  preview?: string;
  started_at?: number;
  message_count?: number;
  source?: string;
  profile?: string;
  last_active?: number;
  is_active?: boolean;
  unread?: boolean;
  pinned?: boolean;
  model?: string;
  snippet?: string;
}

export interface ProfileSessionRef {
  id?: string;
  resolved_id?: string | null;
  title?: string | null;
  preview?: string | null;
  started_at?: number | null;
  [key: string]: unknown;
}

export interface ProfileRow {
  name: string;
  path?: string;
  is_default?: boolean;
  model?: string | null;
  provider?: string | null;
  description?: string;
  display_name?: string;
  skill_count?: number;
  role?: "setup" | null;
  last_session?: ProfileSessionRef | null;
  canonical_session?: ProfileSessionRef | null;
  ui_meta?: Record<string, unknown> | null;
  has_avatar?: boolean;
}

export interface CapabilityEntry {
  name: string;
  enabled?: boolean;
  label?: string;
  description?: string;
  tool_count?: number;
  transport?: string;
}

export interface ProfileDescription {
  name: string;
  description?: string;
  soul?: string;
  model: { provider?: string; default?: string };
  skills?: CapabilityEntry[];
  toolsets?: CapabilityEntry[];
  toolsets_pinned?: boolean;
  mcp_servers?: CapabilityEntry[];
}

export interface ModelOptionProvider {
  slug: string;
  name: string;
  models?: string[];
  is_current?: boolean | null;
  authenticated?: boolean | null;
  featured_models?: string[] | null;
  warning?: string | null;
}

export interface ModelOptionsResult {
  providers: ModelOptionProvider[];
  model?: string;
  provider?: string;
}

export interface RoomMember {
  member_id?: string | null;
  profile?: string | null;
  handle?: string | null;
  display_name?: string | null;
  [key: string]: unknown;
}

export interface Room {
  room_id: string;
  name: string;
  members: RoomMember[];
  created_at: number;
  updated_at: number;
  latest_seq?: number | null;
  disbanded_at?: number | null;
}

export interface RoomEvent {
  room_id: string;
  seq: number;
  event_id: string;
  kind: string;
  actor: Record<string, unknown> | string;
  payload: Record<string, unknown>;
  created_at: number;
}

export interface GatewayEvent {
  type: string;
  session_id?: string;
  seq?: number;
  payload?: any;
}

export type ApprovalChoice = "once" | "session" | "always" | "deny";

/** A server→client request (the agent asking the user something). */
export interface ServerRequest {
  id: string;
  method: string;
  params: Record<string, any>;
}
