import React from "react";
import { ActivityIndicator, View } from "react-native";
import { Redirect } from "expo-router";
import { InboxScreen } from "@/features/inbox/InboxScreen";
import { useGateway } from "@/lib/store/GatewayProvider";
import { useTheme } from "@/ui/theme";

/** Home: the Conversations / Sessions inbox. */
export default function Home() {
  const { loaded, config } = useGateway();
  const { colors } = useTheme();
  if (!loaded)
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.accentText} />
      </View>
    );
  if (!config) return <Redirect href="/connect" />;
  return <InboxScreen />;
}
