import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { errorText, useGateway } from "@/lib/store/GatewayProvider";
import { roomMembers, roomPreview, type RoomPreview } from "./groupEvents";
import type { GroupLogPage, GroupRoom } from "./types";

const PREVIEW_TAIL = 6;
const MAX_PREVIEWS = 30;

/** Rooms hosted by the gateway, newest activity first, each with a last-message preview. */
export function useGroupRooms() {
  const { call, connection, showToast } = useGateway();
  const [rooms, setRooms] = useState<GroupRoom[]>([]);
  const [previews, setPreviews] = useState<Record<string, RoomPreview | null>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const inflight = useRef(false);

  const load = useCallback(
    async (manual = false) => {
      if (inflight.current || connection !== "open") return;
      inflight.current = true;
      if (manual) setRefreshing(true);
      try {
        const result = await call<{ rooms?: GroupRoom[] }>("groups.list", { limit: 100, offset: 0 });
        const list = (result.rooms ?? []).filter((room) => room.disbanded_at == null);
        setRooms(list);
        // Previews: one short log tail per room, in parallel; a failure just leaves the row without one.
        const tails = await Promise.allSettled(
          list.slice(0, MAX_PREVIEWS).map(async (room) => {
            const latest = room.latest_seq ?? 0;
            if (latest <= 0) return [room.room_id, null] as const;
            const page = await call<GroupLogPage>("groups.log", {
              room_id: room.room_id,
              since_seq: Math.max(0, latest - PREVIEW_TAIL),
              limit: PREVIEW_TAIL,
            });
            return [room.room_id, roomPreview(page.events ?? [], roomMembers(room))] as const;
          }),
        );
        const next: Record<string, RoomPreview | null> = {};
        for (const tail of tails) if (tail.status === "fulfilled") next[tail.value[0]] = tail.value[1];
        setPreviews((prev) => ({ ...prev, ...next }));
      } catch (error) {
        showToast(errorText(error, "Could not load group chats"), "error");
      } finally {
        inflight.current = false;
        setLoading(false);
        setRefreshing(false);
      }
    },
    [call, connection, showToast],
  );

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // No socket on the way: stop showing the spinner (adjusted during render, not in an effect).
  const offline = connection !== "open" && connection !== "connecting" && connection !== "reconnecting";
  if (offline && loading) setLoading(false);

  const lastActivity = (room: GroupRoom) => Math.max(room.updated_at ?? 0, previews[room.room_id]?.at ?? 0);
  const sorted = [...rooms].sort((a, b) => lastActivity(b) - lastActivity(a));

  return { rooms: sorted, previews, loading, refreshing, refresh: () => load(true), lastActivity };
}
