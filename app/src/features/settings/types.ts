/**
 * Response shapes for the Hermes dashboard REST routes used by Settings.
 * Verified against hermes_cli/web_routers/{status,skills,cron,actions}.py and a live gateway.
 */

export interface PlatformStatus {
  state?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  needs_attention?: boolean;
  updated_at?: string | null;
}

/** GET /api/status (public liveness probe). */
export interface GatewayStatus {
  version?: string;
  release_date?: string;
  gateway_running?: boolean;
  gateway_state?: string | null;
  gateway_platforms?: Record<string, PlatformStatus> | null;
  gateway_exit_reason?: string | null;
  active_agents?: number;
  active_sessions?: number;
  overall?: string;
  profiles?: string[];
  gateway_mode?: string;
}

/** GET /api/hermes/update/check */
export interface UpdateCheck {
  install_method?: string;
  current_version?: string;
  behind?: number | null;
  update_available?: boolean;
  update_command?: string | null;
  message?: string | null;
}

/** GET /api/skills?profile= — array of these. */
export interface Skill {
  name: string;
  description?: string | null;
  category?: string | null;
  enabled: boolean;
  usage?: number;
  provenance?: "hub" | "bundled" | "agent" | string;
}

export type CronSchedule =
  | { kind: "interval"; minutes: number; display?: string }
  | { kind: "cron"; expr: string; display?: string }
  | { kind: "once"; run_at: string; display?: string }
  | { kind?: string; display?: string; expr?: string; minutes?: number; run_at?: string };

export interface CronOrigin {
  platform?: string | null;
  chat_id?: string | null;
  chat_name?: string | null;
}

/** GET /api/cron/jobs?profile=all — array of these (cron/jobs.py job dict + profile fields). */
export interface CronJob {
  id: string;
  name?: string | null;
  prompt?: string | null;
  skills?: string[] | null;
  schedule?: CronSchedule | null;
  schedule_display?: string | null;
  enabled?: boolean;
  state?: string | null;
  paused_reason?: string | null;
  next_run_at?: string | null;
  last_run_at?: string | null;
  last_status?: string | null;
  last_error?: string | null;
  last_delivery_error?: string | null;
  deliver?: string | null;
  origin?: CronOrigin | null;
  repeat?: { times?: number | null; completed?: number } | null;
  profile?: string;
  profile_name?: string;
}

/** GET /api/cron/delivery-targets?profile= */
export interface DeliveryTarget {
  id: string;
  name: string;
  home_target_set?: boolean;
  home_env_var?: string | null;
}

/** POST /api/cron/jobs?profile= body (subset of web_models.CronJobCreate). */
export interface CronJobCreateBody {
  name: string;
  prompt: string;
  schedule: string;
  deliver: string;
}
