import React, { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { makeStyles, space } from "@/ui/theme";

const PULSE = { duration: 900, easing: Easing.inOut(Easing.ease) };
const WIDTHS = [
  ["46%", "82%"],
  ["34%", "68%"],
  ["52%", "74%"],
  ["40%", "88%"],
  ["30%", "62%"],
  ["44%", "78%"],
] as const;

/** First-load placeholder shaped like the rows it stands in for; one shared opacity pulse. */
export function SkeletonRows({ count = 6, avatar = 48 }: { count?: number; avatar?: number }) {
  const styles = useStyles();
  const reduced = useReducedMotion();
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (reduced) return;
    opacity.set(withRepeat(withTiming(0.5, PULSE), -1, true));
    return () => {
      cancelAnimation(opacity);
      opacity.set(1);
    };
  }, [opacity, reduced]);

  const pulse = useAnimatedStyle(() => ({ opacity: opacity.get() }));

  return (
    <Animated.View style={pulse} accessibilityLabel="Loading" accessibilityRole="progressbar">
      {Array.from({ length: count }, (_, index) => {
        const [title, line] = WIDTHS[index % WIDTHS.length];
        return (
          <View key={index} style={styles.row}>
            <View style={[styles.bar, { width: avatar, height: avatar, borderRadius: avatar / 2 }]} />
            <View style={styles.copy}>
              <View style={[styles.bar, styles.title, { width: title }]} />
              <View style={[styles.bar, styles.line, { width: line }]} />
            </View>
          </View>
        );
      })}
    </Animated.View>
  );
}

const useStyles = makeStyles((colors) => ({
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: 11 },
  copy: { flex: 1, gap: 8 },
  bar: { backgroundColor: colors.surface, borderRadius: 6 },
  title: { height: 14 },
  line: { height: 12 },
}));
