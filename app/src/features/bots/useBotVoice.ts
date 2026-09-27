import { useCallback, useEffect, useRef, useState } from "react";
import { AudioPlayer, createAudioPlayer, setAudioModeAsync } from "expo-audio";
import { errorText, useGateway } from "@/lib/store/GatewayProvider";
import { playableUri } from "@/features/chat/fileData";
import { haptic } from "@/ui/primitives";

export type Voice = { voice_id: string; name: string; label: string };
export type TtsConfig = { provider?: string; elevenlabs?: { voice_id?: string; model_id?: string } };

/** Hermes's default ElevenLabs voice when a profile names none (tools/tts_tool_providers.py). */
export const DEFAULT_VOICE_ID = "pNInz6obpgDQGcFmaJgB";

/**
 * A bot's speaking voice: its profile's `tts` config in Hermes, which voice mode, "Read aloud" and
 * the bot's own voice replies all use. Voices come from the ElevenLabs account Hermes holds the
 * key for; the key never reaches the phone.
 */
export function useBotVoice(profile: string, botName: string) {
  const { get, showToast, connection } = useGateway();
  const [tts, setTts] = useState<TtsConfig | null>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [available, setAvailable] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const player = useRef<AudioPlayer | null>(null);
  const q = `?profile=${encodeURIComponent(profile)}`;

  const load = useCallback(
    () =>
      Promise.all([
        get<{ tts?: TtsConfig }>(`/api/config${q}`),
        get<{ available?: boolean; voices?: Voice[] }>(`/api/audio/elevenlabs/voices${q}`).catch(() => ({
          available: false,
          voices: [],
        })),
      ])
        .then(([config, list]) => {
          setTts(config.tts ?? {});
          setAvailable(Boolean(list.available));
          setVoices(list.voices ?? []);
          setLoadError(null);
        })
        .catch((error) => setLoadError(errorText(error, "Couldn't load voice settings"))),
    [get, q],
  );

  useEffect(() => {
    if (connection === "open" && profile) void load();
  }, [connection, load, profile]);

  const stopPreview = useCallback(() => {
    player.current?.remove();
    player.current = null;
    setPreviewing(false);
  }, []);
  useEffect(() => stopPreview, [stopPreview]);

  const preview = useCallback(async () => {
    stopPreview();
    setPreviewing(true);
    try {
      const result = await get<{ data_url: string }>(`/api/audio/speak${q}`, {
        method: "POST",
        body: JSON.stringify({ text: `Hi, I'm ${botName}. This is how I sound when we talk.` }),
      });
      await setAudioModeAsync({ playsInSilentMode: true }).catch(() => undefined);
      const next = createAudioPlayer({ uri: playableUri(result.data_url, `hermes-voice-preview`) });
      next.addListener("playbackStatusUpdate", (status) => {
        if (status.didJustFinish && player.current === next) stopPreview();
      });
      player.current = next;
      next.play();
    } catch (error) {
      setPreviewing(false);
      showToast(errorText(error, "Couldn't play a sample"), "error");
    }
  }, [botName, get, q, showToast, stopPreview]);

  /** Save immediately (it's its own setting, not part of the editor draft), then let them hear it. */
  const choose = useCallback(
    async (voice: Voice) => {
      if (savingId) return;
      setSavingId(voice.voice_id);
      try {
        await get(`/api/config${q}`, {
          method: "PUT",
          body: JSON.stringify({ config: { tts: { provider: "elevenlabs", elevenlabs: { voice_id: voice.voice_id } } } }),
        });
        setTts((prev) => ({ ...prev, provider: "elevenlabs", elevenlabs: { ...prev?.elevenlabs, voice_id: voice.voice_id } }));
        haptic.success();
        void preview();
      } catch (error) {
        haptic.warn();
        showToast(errorText(error, "Couldn't change the voice"), "error");
      } finally {
        setSavingId(null);
      }
    },
    [get, preview, q, savingId, showToast],
  );

  const provider = tts?.provider || "edge";
  const voiceId = tts?.elevenlabs?.voice_id || DEFAULT_VOICE_ID;
  const current = provider === "elevenlabs" ? voices.find((voice) => voice.voice_id === voiceId) : undefined;

  return {
    loaded: tts !== null,
    loadError,
    reload: load,
    available,
    voices,
    provider,
    voiceId: provider === "elevenlabs" ? voiceId : null,
    currentName: provider === "elevenlabs" ? (current?.name ?? (voiceId === DEFAULT_VOICE_ID ? "Adam (default)" : voiceId)) : null,
    savingId,
    choose,
    preview,
    previewing,
    stopPreview,
  };
}
