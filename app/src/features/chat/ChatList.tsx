import React, { ReactElement, useEffect, useRef, useState } from "react";
import { FlatList, View } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { haptic, Icon, PressScale } from "@/ui/primitives";
import { EASE_OUT } from "@/ui/motion";
import { makeStyles, radius, space, useTheme } from "@/ui/theme";
import type { TimelineItem } from "./chatReducer";

/** Scrolled further than about a screen from the newest message. */
const AWAY_PX = 480;
const JUMP_IN = FadeIn.duration(160).easing(EASE_OUT);
const JUMP_OUT = FadeOut.duration(130).easing(EASE_OUT);

/**
 * The conversation: an inverted list (newest at the bottom, anchored) with a "jump to latest"
 * button that appears once you've scrolled up. Scroll position lives on the UI thread; React only
 * hears about it when the threshold is crossed.
 */
export function ChatList({
  data,
  renderItem,
  focusId,
}: {
  data: TimelineItem[];
  renderItem: (info: { item: TimelineItem }) => ReactElement;
  /** Scroll this item into view (search results). */
  focusId?: string | null;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const list = useRef<FlatList<TimelineItem>>(null);
  const offset = useSharedValue(0);
  const [away, setAway] = useState(false);
  // Pinned to the newest message until the user scrolls away; late-sizing content (images, file
  // cards, markdown) and history arriving after open then can't leave them partway up the chat.
  const pinned = useRef(true);
  const toLatest = (animated: boolean) => list.current?.scrollToOffset({ offset: 0, animated });
  const settle = (y: number) => {
    pinned.current = y < 40;
  };

  // Search jumps: centre the focused message; unpin so late layout doesn't yank back to the bottom.
  // `data` is read at jump time only (via a ref): new messages arriving must not re-trigger the jump.
  const latestData = useRef(data);
  useEffect(() => {
    latestData.current = data;
  }, [data]);
  useEffect(() => {
    if (!focusId) return;
    const index = latestData.current.findIndex((item) => item.id === focusId);
    if (index < 0) return;
    pinned.current = false;
    list.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
  }, [focusId]);

  const onScroll = useAnimatedScrollHandler((event) => {
    offset.set(event.contentOffset.y);
  });
  useAnimatedReaction(
    () => offset.get() > AWAY_PX,
    (now, before) => {
      if (now !== before) scheduleOnRN(setAway, now);
    },
  );

  return (
    <View style={styles.root}>
      <Animated.FlatList
        ref={list}
        inverted
        data={data}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onScrollBeginDrag={() => {
          pinned.current = false;
        }}
        onScrollEndDrag={(event) => settle(event.nativeEvent.contentOffset.y)}
        onMomentumScrollEnd={(event) => settle(event.nativeEvent.contentOffset.y)}
        onContentSizeChange={() => {
          if (pinned.current) toLatest(false);
        }}
        contentContainerStyle={styles.content}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: 80 }}
        onScrollToIndexFailed={(info) => {
          // Not measured yet: get close, then retry once the rows around it have rendered.
          list.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
          setTimeout(() => list.current?.scrollToIndex({ index: info.index, viewPosition: 0.5, animated: true }), 120);
        }}
        initialNumToRender={12}
        windowSize={11}
      />
      {away ? (
        <Animated.View entering={JUMP_IN} exiting={JUMP_OUT} style={styles.jumpWrap}>
          <PressScale
            accessibilityRole="button"
            accessibilityLabel="Jump to latest message"
            onPress={() => {
              haptic.tap();
              pinned.current = true;
              toLatest(true);
            }}
            style={styles.jump}
          >
            <Icon name="arrow-down" size={18} color={colors.text} />
          </PressScale>
        </Animated.View>
      ) : null}
    </View>
  );
}

/** Opening a chat: the rough shape of a conversation instead of a spinner. */
export function ChatSkeleton() {
  const styles = useStyles();
  const reduced = useReducedMotion();
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (reduced) return;
    pulse.set(withRepeat(withTiming(0.5, { duration: 900, easing: Easing.inOut(Easing.ease) }), -1, true));
  }, [pulse, reduced]);
  const fade = useAnimatedStyle(() => ({ opacity: pulse.get() }));
  return (
    <Animated.View style={[styles.skeleton, fade]} accessibilityLabel="Loading conversation" accessibilityRole="progressbar">
      <View style={[styles.bar, styles.mine, { width: "46%" }]} />
      <View style={styles.theirs}>
        <View style={[styles.bar, { width: "92%" }]} />
        <View style={[styles.bar, { width: "84%" }]} />
        <View style={[styles.bar, { width: "60%" }]} />
      </View>
      <View style={[styles.bar, styles.mine, { width: "34%" }]} />
      <View style={styles.theirs}>
        <View style={[styles.bar, { width: "88%" }]} />
        <View style={[styles.bar, { width: "70%" }]} />
      </View>
    </Animated.View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1 },
  content: { paddingHorizontal: space.lg, paddingVertical: space.md },
  jumpWrap: { position: "absolute", right: space.lg, bottom: space.md },
  jump: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.scheme === "light" ? colors.bg : colors.overlay,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: colors.shadow,
    shadowOpacity: 1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  skeleton: { flex: 1, justifyContent: "flex-end", gap: space.lg, paddingHorizontal: space.lg, paddingBottom: space.xl },
  theirs: { gap: space.sm },
  mine: { alignSelf: "flex-end", height: 40, borderRadius: radius.lg },
  bar: { height: 14, borderRadius: 7, backgroundColor: colors.raised },
}));
