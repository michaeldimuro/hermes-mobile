import React, { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from "react-native";
import { Button, Icon, Sheet } from "@/ui/primitives";
import { makeStyles, radius, space, useTheme } from "@/ui/theme";
import { EditorCard, ValueRow } from "./EditorBits";
import { useBotVoice } from "./useBotVoice";

/** Bot editor section: pick the ElevenLabs voice this bot speaks with. */
export function VoiceCard({ profile, botName }: { profile: string; botName: string }) {
  const styles = useStyles();
  const { colors, type, scheme } = useTheme();
  const voice = useBotVoice(profile, botName);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? voice.voices.filter((item) => item.label.toLowerCase().includes(q)) : voice.voices;
  }, [query, voice.voices]);

  const body = () => {
    if (voice.loadError)
      return (
        <View style={styles.notice}>
          <Text style={type.small}>{voice.loadError}</Text>
          <Button title="Retry" variant="secondary" onPress={() => void voice.reload()} />
        </View>
      );
    if (!voice.loaded) return <ActivityIndicator color={colors.muted} style={styles.loading} />;
    if (!voice.available)
      return (
        <Text style={type.small}>
          ElevenLabs isn&apos;t set up for this bot yet. On the Hermes machine, run scripts/voice/setup.sh from the Hermes
          Mobile folder, then come back here.
        </Text>
      );
    return (
      <>
        <ValueRow
          label={voice.provider === "elevenlabs" ? "ELEVENLABS" : voice.provider.toUpperCase()}
          value={voice.currentName ?? "Built-in voice. Pick one to use ElevenLabs"}
          onPress={() => {
            setQuery("");
            setOpen(true);
          }}
        />
        <Button
          title={voice.previewing ? "Stop" : "Hear it"}
          icon={voice.previewing ? "stop" : "play"}
          variant="secondary"
          onPress={() => (voice.previewing ? voice.stopPreview() : void voice.preview())}
          style={styles.hear}
        />
      </>
    );
  };

  return (
    <>
      <EditorCard
        icon="volume-high-outline"
        title="Voice"
        hint={`How ${botName} sounds in voice mode and when reading replies aloud. Changes save right away.`}
      >
        {body()}
      </EditorCard>

      <Sheet visible={open} onClose={() => setOpen(false)} title="Choose a voice">
        <View style={styles.search}>
          <Icon name="search" size={16} color={colors.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search voices"
            placeholderTextColor={colors.faint}
            keyboardAppearance={scheme}
            autoCorrect={false}
            style={styles.searchInput}
            accessibilityLabel="Search voices"
          />
        </View>
        <FlatList
          data={shown}
          keyExtractor={(item) => item.voice_id}
          style={styles.list}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<Text style={[type.small, styles.empty]}>No voices match “{query}”.</Text>}
          renderItem={({ item }) => {
            const selected = item.voice_id === voice.voiceId;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={item.label}
                onPress={() => {
                  setOpen(false);
                  void voice.choose(item);
                }}
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.raised }]}
              >
                <Text style={[type.heading, styles.rowText]} numberOfLines={1}>
                  {item.label}
                </Text>
                {voice.savingId === item.voice_id ? (
                  <ActivityIndicator size="small" color={colors.muted} />
                ) : selected ? (
                  <Icon name="checkmark" size={20} color={colors.accentText} />
                ) : null}
              </Pressable>
            );
          }}
        />
      </Sheet>
    </>
  );
}

const useStyles = makeStyles((colors) => ({
  notice: { gap: space.sm, alignItems: "flex-start" },
  loading: { alignSelf: "flex-start", marginVertical: space.sm },
  hear: { alignSelf: "flex-start", marginTop: space.sm },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    marginHorizontal: space.lg,
    marginBottom: space.sm,
    paddingHorizontal: space.md,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.raised,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 15 },
  list: { maxHeight: 420 },
  empty: { padding: space.lg },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    minHeight: 48,
    paddingHorizontal: space.lg,
    marginHorizontal: space.sm,
    borderRadius: radius.md,
  },
  rowText: { flex: 1, fontWeight: "500" },
}));
