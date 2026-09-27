import React, { useEffect, useRef } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { LOCK_AFTER_MS, lockNow, unlock, useAppLock } from "@/lib/store/appLock";
import { Button, Icon } from "@/ui/primitives";
import { makeStyles, space, useTheme } from "@/ui/theme";

/** Covers the app while locked and asks for Face ID; also hides content in the app switcher. */
export function AppLockGate() {
  const styles = useStyles();
  const { colors, type } = useTheme();
  const { enabled, locked, ready } = useAppLock();
  const backgroundedAt = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "background") backgroundedAt.current = Date.now();
      if (next === "active" && backgroundedAt.current && Date.now() - backgroundedAt.current > LOCK_AFTER_MS) lockNow();
      if (next === "active") backgroundedAt.current = null;
    });
    return () => sub.remove();
  }, [enabled]);

  // Ask straight away when the lock engages while the app is in front.
  useEffect(() => {
    if (locked && AppState.currentState === "active") void unlock();
  }, [locked]);

  if (ready && !locked) return null;
  return (
    <Animated.View entering={FadeIn.duration(120)} exiting={FadeOut.duration(200)} style={[StyleSheet.absoluteFill, styles.cover]}>
      {ready ? (
        <View style={styles.center}>
          <View style={styles.badge}>
            <Icon name="lock-closed" size={28} color={colors.text} />
          </View>
          <Text style={type.title}>Hermes is locked</Text>
          <Button title="Unlock" icon="scan-outline" onPress={() => void unlock()} style={{ marginTop: space.md }} />
        </View>
      ) : null}
    </Animated.View>
  );
}

const useStyles = makeStyles((colors) => ({
  cover: { backgroundColor: colors.bg, zIndex: 100 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.sm },
  badge: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.raised, alignItems: "center", justifyContent: "center", marginBottom: space.sm },
}));
