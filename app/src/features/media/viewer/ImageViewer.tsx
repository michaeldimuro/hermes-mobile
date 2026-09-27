import React, { useRef, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { Image } from "expo-image";

const ZOOM = 2.5;

/**
 * Full-screen image. iOS: native pinch-zoom via ScrollView zoom scales, double-tap toggles zoom.
 * Android/web (no ScrollView zoom): double-tap renders the image at 2.5× inside a 2-axis pan.
 */
export function ImageViewer({ uri, label }: { uri: string; label: string }) {
  const { width, height } = useWindowDimensions();
  const [zoomed, setZoomed] = useState(false);
  const lastTap = useRef(0);
  const scroller = useRef<ScrollView>(null);

  const onPress = () => {
    const now = Date.now();
    const isDouble = now - lastTap.current < 280;
    lastTap.current = isDouble ? 0 : now;
    if (!isDouble) return;
    if (Platform.OS === "ios") {
      const next = !zoomed;
      const w = next ? width / ZOOM : width;
      const h = next ? height / ZOOM : height;
      scroller.current?.scrollResponderZoomTo({ x: (width - w) / 2, y: (height - h) / 2, width: w, height: h, animated: true });
      setZoomed(next);
    } else setZoomed((value) => !value);
  };

  const image = (size: { width: number; height: number }) => (
    <Pressable onPress={onPress} accessibilityRole="image" accessibilityLabel={label} accessibilityHint="Double-tap to zoom">
      <Image source={{ uri }} style={size} contentFit="contain" transition={120} />
    </Pressable>
  );

  if (Platform.OS === "ios") {
    return (
      <ScrollView
        ref={scroller}
        style={styles.fill}
        contentContainerStyle={styles.center}
        maximumZoomScale={5}
        minimumZoomScale={1}
        centerContent
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
      >
        {image({ width, height: height * 0.8 })}
      </ScrollView>
    );
  }
  if (!zoomed) return <View style={[styles.fill, styles.center]}>{image({ width, height: height * 0.8 })}</View>;
  return (
    <ScrollView style={styles.fill} contentContainerStyle={styles.center}>
      <ScrollView horizontal contentContainerStyle={styles.center}>
        {image({ width: width * ZOOM, height: height * 0.8 * ZOOM })}
      </ScrollView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flexGrow: 1, alignItems: "center", justifyContent: "center" },
});
