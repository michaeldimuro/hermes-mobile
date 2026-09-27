import React, { ReactNode, useEffect, useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import * as Haptics from "expo-haptics";
import { EASE_OUT } from "./motion";
import { makeStyles, radius, space } from "./theme";

/** Where a flick would come to rest if it kept decelerating (Apple's exponential decay). */
function project(velocity: number, decelerationRate = 0.998) {
  "worklet";
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/** Past the edge, the sheet follows less and less instead of stopping dead. */
function rubberband(overshoot: number, dimension: number, constant = 0.55) {
  "worklet";
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

const ENTER = { duration: 350, dampingRatio: 1 } as const;
const EXIT_MS = 220;
const FADE_MS = 180;

/**
 * Bottom sheet. The backdrop fades while the panel slides (they no longer move as one block), and
 * the handle area drags: a flick or a pull past 40% dismisses, anything less springs home.
 * Reduced motion: a plain crossfade, no travel.
 */
export function Sheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { height: screen } = useWindowDimensions();
  const reduced = useReducedMotion();

  // Stay mounted through the exit animation; unmount when it finishes.
  const [mounted, setMounted] = useState(visible);
  if (visible && !mounted) setMounted(true);

  const offset = useSharedValue(screen); // panel travel below its resting place
  const fade = useSharedValue(0); // reduced-motion opacity
  const height = useSharedValue(screen);
  const start = useSharedValue(0);

  useEffect(() => {
    if (!mounted) return;
    if (visible) {
      if (reduced) {
        offset.set(0);
        fade.set(withTiming(1, { duration: FADE_MS, easing: EASE_OUT }));
      } else {
        fade.set(1);
        offset.set(withSpring(0, ENTER));
      }
      return;
    }
    const done = (finished?: boolean) => {
      "worklet";
      if (finished) scheduleOnRN(setMounted, false);
    };
    if (reduced) fade.set(withTiming(0, { duration: FADE_MS, easing: EASE_OUT }, done));
    else offset.set(withTiming(height.get(), { duration: EXIT_MS, easing: EASE_OUT }, done));
  }, [visible, mounted, reduced, offset, fade, height]);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY([-10, 10])
        .onStart(() => {
          start.set(offset.get()); // grab it where the eye last saw it, even mid-animation
        })
        .onUpdate((event) => {
          const next = start.get() + event.translationY;
          offset.set(next >= 0 ? next : rubberband(next, height.get()));
        })
        .onEnd((event) => {
          const projected = offset.get() + project(event.velocityY);
          if (projected > height.get() * 0.4) {
            offset.set(
              withSpring(height.get(), { duration: 300, dampingRatio: 1, velocity: event.velocityY, overshootClamping: true }),
            );
            scheduleOnRN(onClose);
          } else {
            offset.set(withSpring(0, { duration: 300, dampingRatio: 0.8, velocity: event.velocityY }));
            scheduleOnRN(Haptics.impactAsync, Haptics.ImpactFeedbackStyle.Light);
          }
        }),
    [height, offset, onClose, start],
  );

  const backdrop = useAnimatedStyle(() => ({
    opacity: fade.get() * interpolate(offset.get(), [0, height.get()], [1, 0], Extrapolation.CLAMP),
  }));
  const panel = useAnimatedStyle(() => ({ opacity: fade.get(), transform: [{ translateY: offset.get() }] }));

  if (!mounted) return null;
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <GestureHandlerRootView style={StyleSheet.absoluteFill}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, backdrop]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" style={{ flex: 1 }} onPress={onClose} />
        </Animated.View>
        <Animated.View
          onLayout={(event) => height.set(event.nativeEvent.layout.height)}
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, space.lg) }, panel]}
          accessibilityViewIsModal
        >
          <GestureDetector gesture={pan}>
            <View style={styles.handle} accessibilityHint="Drag down to close">
              <View style={styles.grabber} />
              {title ? <Text style={styles.title}>{title}</Text> : null}
            </View>
          </GestureDetector>
          {children}
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const useStyles = makeStyles((colors, type) => ({
  scrim: { backgroundColor: colors.scrim },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.scheme === "light" ? colors.bg : colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    maxHeight: "88%",
  },
  handle: { paddingTop: space.sm },
  grabber: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: colors.borderStrong, marginBottom: space.md },
  title: { ...type.heading, paddingHorizontal: space.xl, marginBottom: space.md },
}));
