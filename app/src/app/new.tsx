import React from "react";
import { useLocalSearchParams } from "expo-router";
import { ChatScreen } from "@/features/chat/ChatScreen";
import { useGateway } from "@/lib/store/GatewayProvider";

/** A fresh standalone session with a bot (`n` is a nonce so "new chat" always starts clean). */
export default function NewChatRoute() {
  const { activeBot } = useGateway();
  const { bot, n } = useLocalSearchParams<{ bot?: string; n?: string }>();
  const profile = bot || activeBot;
  return <ChatScreen key={`${profile}:${n ?? ""}`} profile={profile} />;
}
