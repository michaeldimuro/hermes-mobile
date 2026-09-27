import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useVideoPlayer, VideoView, type VideoSource } from "expo-video";
import { useAudioPlayer, useAudioPlayerStatus, type AudioSource } from "expo-audio";
import { Icon, IconButton } from "@/ui/primitives";
import { makeStyles, radius, space, useTheme } from "@/ui/theme";

export type PlayableSource = { uri: string; headers?: Record<string, string> };

/** expo-video player with native controls; streams with auth headers where supported. */
export function VideoPlayer({ source, label }: { source: PlayableSource; label: string }) {
  const videoSource: VideoSource = source.headers ? { uri: source.uri, headers: source.headers } : { uri: source.uri };
  const player = useVideoPlayer(videoSource, (instance) => {
    instance.play();
  });
  return (
    <VideoView
      player={player}
      style={styles.video}
      nativeControls
      contentFit="contain"
      fullscreenOptions={{ enable: true }}
      accessibilityLabel={label}
    />
  );
}

function clock(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = String(whole % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${secs}` : `${minutes}:${secs}`;
}

/** Simple expo-audio player: play/pause, ±15 s, tap-to-seek progress bar. */
export function AudioPlayer({ source, label }: { source: PlayableSource; label: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const audioSource: AudioSource = source.headers ? { uri: source.uri, headers: source.headers } : { uri: source.uri };
  const player = useAudioPlayer(audioSource);
  const status = useAudioPlayerStatus(player);
  const [barWidth, setBarWidth] = useState(0);
  const duration = status.duration || 0;
  const progress = duration > 0 ? Math.min(1, status.currentTime / duration) : 0;

  const toggle = () => {
    if (status.playing) player.pause();
    else {
      if (status.didJustFinish || (duration > 0 && status.currentTime >= duration - 0.25)) player.seekTo(0).catch(() => undefined);
      player.play();
    }
  };
  const skip = (delta: number) =>
    player.seekTo(Math.max(0, Math.min(duration || Infinity, status.currentTime + delta))).catch(() => undefined);

  return (
    <View style={styles.audio}>
      <View style={styles.art}>
        <Icon name="musical-notes" size={56} color={colors.accentText} />
      </View>
      <Text style={styles.title} numberOfLines={2}>
        {label}
      </Text>
      <Pressable
        accessibilityRole="adjustable"
        accessibilityLabel="Playback position"
        accessibilityValue={{ min: 0, max: Math.round(duration), now: Math.round(status.currentTime) }}
        onLayout={(event) => setBarWidth(event.nativeEvent.layout.width)}
        onPress={(event) => {
          if (barWidth > 0 && duration > 0) player.seekTo((event.nativeEvent.locationX / barWidth) * duration).catch(() => undefined);
        }}
        style={styles.barHit}
      >
        <View style={styles.bar}>
          <View style={[styles.barFill, { width: `${progress * 100}%` }]} />
        </View>
      </Pressable>
      <View style={styles.times}>
        <Text style={styles.time}>{clock(status.currentTime)}</Text>
        <Text style={styles.time}>{status.isLoaded ? clock(duration) : "Loading…"}</Text>
      </View>
      <View style={styles.controls}>
        <IconButton icon="play-back" label="Back 15 seconds" size={26} onPress={() => skip(-15)} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={status.playing ? "Pause" : "Play"}
          onPress={toggle}
          style={({ pressed }) => [styles.play, pressed && { opacity: 0.8 }]}
        >
          <Icon name={status.playing ? "pause" : "play"} size={30} color={colors.primaryInk} />
        </Pressable>
        <IconButton icon="play-forward" label="Forward 15 seconds" size={26} onPress={() => skip(15)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({ video: { flex: 1, backgroundColor: "#000" } });

const useStyles = makeStyles((colors, type) => ({
  audio: { flex: 1, justifyContent: "center", paddingHorizontal: space.xl, gap: space.md },
  art: {
    alignSelf: "center",
    width: 160,
    height: 160,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: space.lg,
  },
  title: { ...type.heading, textAlign: "center", marginBottom: space.md },
  barHit: { paddingVertical: space.sm },
  bar: { height: 4, borderRadius: 2, backgroundColor: colors.raised, overflow: "hidden" },
  barFill: { height: 4, backgroundColor: colors.accent },
  times: { flexDirection: "row", justifyContent: "space-between" },
  time: { ...type.small, fontVariant: ["tabular-nums"] },
  controls: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.xl, marginTop: space.md },
  play: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
}));
