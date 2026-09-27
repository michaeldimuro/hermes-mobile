/**
 * Hosted group-room wire shapes (subset of hermes-agent `gateway-contract.generated.ts`, `groups.*`).
 * Kept local so the section does not depend on the looser shared `Room`/`RoomEvent` types.
 */

export interface GroupMember {
  member_id?: string | null;
  profile?: string | null;
  handle?: string | null;
  display_name?: string | null;
  target?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface GroupRoom {
  room_id: string;
  name: string;
  members: GroupMember[];
  created_at: number;
  updated_at: number;
  revision?: number;
  latest_seq?: number | null;
  disbanded_at?: number | null;
}

export interface GroupActor {
  kind: string;
  id: string;
  profile?: string;
  display_name?: string;
  connection_id?: string;
}

export interface GroupEvent {
  room_id: string;
  seq: number;
  event_id: string;
  kind: string;
  actor: GroupActor;
  payload: Record<string, unknown>;
  /** Unix seconds (float). */
  created_at: number;
}

export interface GroupLogPage {
  events: GroupEvent[];
  cursor: number;
  latest_seq: number;
  has_more: boolean;
}

export interface DriverStatus {
  running: boolean;
  working: boolean;
  blocked: boolean;
  counts: Record<string, number>;
  pending_actions: Record<string, unknown>[];
}

export interface GroupStateResult {
  room: GroupRoom;
  driver_status?: DriverStatus | null;
}

/** Roster row as `groups.create` expects it (`hosted_room_discussion._validate_member`). */
export interface GroupMemberInput {
  member_id: string;
  profile: string;
  handle: string;
  display_name: string;
  target: { kind: "local"; profile: string };
}

export const MIN_GROUP_MEMBERS = 2;
export const MAX_GROUP_MEMBERS = 6;
