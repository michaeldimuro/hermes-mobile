import { useCallback, useRef, useState } from "react";
import { Platform } from "react-native";
import {
  AudioPlayer,
  createAudioPlayer,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import { errorText, useGateway } from "@/lib/store/GatewayProvider";
import { haptic } from "@/ui/primitives";
import { speakableText } from "@/features/voice/speech";
import { ensureMicPermission, MIC_OFF_MESSAGE } from "@/features/voice/micPermission";
import { pickedFileDataUrl, playableUri } from "./fileData";

export { speakableText };

/**
 * Voice on the phone, speech work on Hermes: records with the phone's mic and transcribes through
 * Hermes (`/api/audio/transcribe`, the bot's configured STT), and reads replies aloud with the
 * bot's configured TTS (`/api/audio/speak`).
 */
export function useVoice(profile: string) {
  const { get, showToast } = useGateway();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const player = useRef<AudioPlayer | null>(null);
  const q = `?profile=${encodeURIComponent(profile)}`;

  const start = useCallback(async () => {
    if (!(await ensureMicPermission())) {
      showToast(MIC_OFF_MESSAGE, "warn");
      return false;
    }
    player.current?.pause();
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    haptic.press();
    setRecording(true);
    return true;
  }, [recorder, showToast]);

  /** Stop and transcribe; resolves with the text ("" when nothing was heard or it failed). */
  const stop = useCallback(async () => {
    if (!recording) return "";
    setRecording(false);
    await recorder.stop();
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
    haptic.tap();
    const uri = recorder.uri;
    if (!uri) return "";
    setTranscribing(true);
    try {
      const mime = Platform.OS === "web" ? "audio/webm" : "audio/mp4";
      const dataUrl = await pickedFileDataUrl({ uri, mimeType: mime });
      const result = await get<{ transcript?: string }>(`/api/audio/transcribe${q}`, {
        method: "POST",
        body: JSON.stringify({ data_url: dataUrl, mime_type: mime }),
      });
      if (!result.transcript) showToast("Didn't catch that. Try again a little closer.", "info");
      return result.transcript ?? "";
    } catch (error) {
      showToast(errorText(error, "Couldn't transcribe that"), "error");
      return "";
    } finally {
      setTranscribing(false);
    }
  }, [get, q, recorder, recording, showToast]);

  const stopSpeaking = useCallback(() => {
    player.current?.pause();
    player.current?.remove();
    player.current = null;
    setSpeakingId(null);
  }, []);

  /** Read `text` aloud; calling again for the same id stops it. */
  const speak = useCallback(
    async (id: string, text: string) => {
      if (speakingId === id) return stopSpeaking();
      stopSpeaking();
      const speech = speakableText(text);
      if (!speech) return;
      setSpeakingId(id);
      try {
        const result = await get<{ data_url: string }>(`/api/audio/speak${q}`, {
          method: "POST",
          body: JSON.stringify({ text: speech }),
        });
        await setAudioModeAsync({ playsInSilentMode: true }).catch(() => undefined);
        const next = createAudioPlayer({ uri: playableUri(result.data_url, `hermes-speech-${Date.now()}`) });
        next.addListener("playbackStatusUpdate", (status) => {
          if (status.didJustFinish) stopSpeaking();
        });
        player.current = next;
        next.play();
      } catch (error) {
        setSpeakingId(null);
        showToast(errorText(error, "Couldn't read that aloud"), "error");
      }
    },
    [get, q, showToast, speakingId, stopSpeaking],
  );

  return { recording, transcribing, start, stop, speak, stopSpeaking, speakingId };
}
