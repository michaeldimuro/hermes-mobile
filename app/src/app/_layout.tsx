import React, { useEffect } from "react";
import { View } from "react-native";
import { router, Stack, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GatewayProvider, useGateway } from "@/lib/store/GatewayProvider";
import { ToastHost } from "@/features/shell/ToastHost";
import { AppLockGate } from "@/features/shell/AppLockGate";
import { DeviceShortcuts } from "@/features/shell/DeviceShortcuts";
import { ThemeProvider, useTheme } from "@/ui/theme";
function ThemedStack() {
  const { colors, scheme } = useTheme();
  const { loaded, config } = useGateway();
  const segments = useSegments();
  // Whatever screen is open, an invalidated session (e.g. expired token) goes back to connect.
  useEffect(() => {
    if (loaded && !config && segments[0] !== "connect")
      router.replace("/connect");
  }, [loaded, config, segments]);
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
          animation: "slide_from_right",
        }}
      >
        <Stack.Screen name="index" options={{ animation: "fade" }} />
        <Stack.Screen
          name="connect"
          options={{ animation: "fade", gestureEnabled: false }}
        />
      </Stack>
      <ToastHost />
      <AppLockGate />
      {config ? <DeviceShortcuts /> : null}
    </View>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <GatewayProvider>
            <ThemedStack />
          </GatewayProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
