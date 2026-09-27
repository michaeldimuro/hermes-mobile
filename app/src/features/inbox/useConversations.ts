import { useMemo } from "react";
import { useGateway } from "@/lib/store/GatewayProvider";
import type { ProfileRow } from "@/lib/gateway/types";
import { botTitle } from "@/features/chat/botMeta";
import { useGroupRooms } from "@/features/groups/useGroupRooms";
import { useDesktopRooms } from "@/features/rooms/useDesktopRooms";
import { previewText, toMs } from "./format";

export type Conversation =
  | { kind: "bot"; key: string; title: string; preview: string; at: number; bot: ProfileRow }
  | {
      kind: "group";
      key: string;
      title: string;
      preview: string;
      at: number;
      /** `desktop` = a Hermes desktop group chat (read-only here); `hosted` = a gateway room. */
      origin: "desktop" | "hosted";
      roomId: string;
      members: string[];
    };

/**
 * The inbox: one row per bot (its continuous "Bot Chat") and one per group chat — Hermes desktop
 * group chats plus gateway-hosted rooms — newest activity first.
 */
export function useConversations() {
  const { profiles, refreshProfiles } = useGateway();
  const desktop = useDesktopRooms();
  const hosted = useGroupRooms();

  const conversations = useMemo<Conversation[]>(() => {
    const bots: Conversation[] = profiles
      .filter((bot) => bot.role !== "setup")
      .map((bot) => {
        const session = bot.canonical_session;
        return {
          kind: "bot",
          key: `bot:${bot.name}`,
          title: botTitle(bot),
          preview: session
            ? previewText(session.preview) ||
              (Number(session.message_count) > 0 ? `${session.message_count} messages` : "No messages yet")
            : bot.description || "Start a conversation",
          at: toMs(Number(session?.last_active ?? session?.started_at ?? 0)),
          bot,
        };
      });
    const rooms: Conversation[] = desktop.rooms.map((room) => ({
      kind: "group",
      key: `desktop:${room.roomId}`,
      title: room.name,
      preview: room.last ? `${room.last.kind === "user" ? "You" : room.last.from}: ${previewText(room.last.text)}` : "No messages yet",
      at: toMs(room.updatedAt),
      origin: "desktop",
      roomId: room.roomId,
      members: room.members.map((member) => member.name),
    }));
    const hostedRooms: Conversation[] = hosted.rooms.map((room) => {
      const preview = hosted.previews[room.room_id];
      return {
        kind: "group",
        key: `hosted:${room.room_id}`,
        title: room.name,
        preview: preview ? `${preview.author ?? "You"}: ${previewText(preview.text)}` : "No messages yet",
        at: toMs(hosted.lastActivity(room)),
        origin: "hosted",
        roomId: room.room_id,
        members: room.members.map((member) => String(member.profile ?? member.member_id ?? "")).filter(Boolean),
      };
    });
    return [...rooms, ...hostedRooms, ...bots].sort((a, b) => b.at - a.at || a.title.localeCompare(b.title));
  }, [desktop.rooms, hosted, profiles]);

  const refresh = async () => {
    await Promise.all([refreshProfiles(), desktop.refresh(), hosted.refresh()]);
  };

  return { conversations, loading: desktop.loading && !profiles.length, refresh };
}
