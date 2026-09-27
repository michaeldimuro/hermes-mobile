import React from "react";
import { useLocalSearchParams } from "expo-router";
import { ChatScreen } from "@/features/chat/ChatScreen";
import { useGateway } from "@/lib/store/GatewayProvider";

/**
 * A bot's continuous conversation — its Hermes "Bot Chat", the same thread Hermes desktop shows.
 * Opens the known canonical session straight away; otherwise it is found or created on first send.
 */
export default function BotConversationRoute() {
  const { profiles } = useGateway();
  const { name } = useLocalSearchParams<{ name: string }>();
  const session = profiles.find((bot) => bot.name === name)?.canonical_session;
  const storedId = session ? String(session.resolved_id || session.id || "") || undefined : undefined;
  return <ChatScreen key={`${name}:${storedId ?? "new"}`} profile={name} storedId={storedId} canonical />;
}
