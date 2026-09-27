import React from "react";
import { Redirect, useLocalSearchParams } from "expo-router";
import { ChatScreen } from "@/features/chat/ChatScreen";
import { useGateway } from "@/lib/store/GatewayProvider";

/** An existing conversation, resumed live from Hermes (also the deep-link target hermes://chat/<id>). */
export default function ChatRoute() {
  const { loaded, config, activeBot } = useGateway();
  const { id, profile } = useLocalSearchParams<{ id: string; profile?: string }>();
  if (loaded && !config) return <Redirect href="/connect" />;
  const bot = profile || activeBot;
  return <ChatScreen key={`${bot}:${id}`} storedId={id} profile={bot} />;
}
