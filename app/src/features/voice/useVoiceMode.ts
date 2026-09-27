import { useEffect, useRef, useState } from "react";
import { RecordingPresets, useAudioRecorder } from "expo-audio";
import { withTiming, type SharedValue } from "react-native-reanimated";
import { errorText, useGateway } from "@/lib/store/GatewayProvider";
import type { TimelineItem } from "@/features/chat/chatReducer";
import { VoiceSession, type VoicePhase } from "./voiceSession";

export type { VoicePhase };

const RECORDING = { ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true };

type Options = {
  profile: string;
  items: TimelineItem[];
  running: boolean;
  send: (text: string) => Promise<unknown> | void;
  interrupt: () => void;
  /** 0..1, the mic level while listening, for the orb. */
  level: SharedValue<number>;
};

/** Runs one `VoiceSession` for as long as the component using it is mounted. */
export function useVoiceMode({ profile, items, running, send, interrupt, level }: Options) {
  const { get, showToast } = useGateway();
  const recorder = useAudioRecorder(RECORDING);
  const [phase, setPhase] = useState<VoicePhase>("starting");
  const [heard, setHeard] = useState("");
  const [saying, setSaying] = useState("");
  const [muted, setMuted] = useState(false);
  const [session, setSession] = useState<VoiceSession | null>(null);

  // The session reads the latest props on demand (it runs from timers and audio callbacks).
  const latest = useRef({ get, showToast, send, interrupt, running, items, profile });
  useEffect(() => {
    latest.current = { get, showToast, send, interrupt, running, items, profile };
  });

  useEffect(() => {
    if (__DEV__) console.info("[voice] session mounting");
    const next = new VoiceSession({
      recorder,
      get: (path, init) => latest.current.get(path, init),
      send: (text) => latest.current.send(text),
      interrupt: () => latest.current.interrupt(),
      toast: (text, toastLevel) => latest.current.showToast(text, toastLevel),
      errorText,
      profile: () => latest.current.profile,
      items: () => latest.current.items,
      running: () => latest.current.running,
      onPhase: setPhase,
      onHeard: setHeard,
      onSaying: setSaying,
      onMuted: setMuted,
      onLevel: (value) => level.set(withTiming(value, { duration: 110 })),
    });
    setSession(next);
    void next.start();
    return () => next.dispose();
  }, [level, recorder]);

  // Each chat update may carry more of the reply to speak.
  useEffect(() => {
    session?.update();
  }, [session, items, running]);

  return {
    phase,
    heard,
    saying,
    muted,
    tap: () => session?.tap(),
    togglePause: () => session?.togglePause(),
  };
}
