import { Platform } from "react-native";
import { AudioPlayer, AudioRecorder, createAudioPlayer, setAudioModeAsync } from "expo-audio";
import { ensureMicPermission, MIC_OFF_MESSAGE } from "./micPermission";
import type { TimelineItem } from "@/features/chat/chatReducer";
import { pickedFileDataUrl, playableUri } from "@/features/chat/fileData";
import { haptic } from "@/ui/primitives";
import { takeSentences } from "./speech";
import { createVad, stepVad, type VadState } from "./vad";

/** Development breadcrumbs: a native crash leaves no JS error, so these show where it stopped. */
const trace = (step: string) => {
  if (__DEV__) console.info(`[voice] ${step}`);
};

export type VoicePhase = "starting" | "listening" | "paused" | "transcribing" | "thinking" | "speaking";

const TICK_MS = 100;
/** A send that produced no reply at all (a command, a failed turn) stops waiting after this. */
const NO_REPLY_MS = 8000;

export type VoiceIO = {
  recorder: AudioRecorder;
  get: <T>(path: string, init?: RequestInit) => Promise<T>;
  send: (text: string) => Promise<unknown> | void;
  interrupt: () => void;
  toast: (text: string, level: "warn" | "error") => void;
  errorText: (error: unknown, fallback: string) => string;
  profile: () => string;
  items: () => TimelineItem[];
  running: () => boolean;
  /** UI outputs. */
  onPhase: (phase: VoicePhase) => void;
  onHeard: (text: string) => void;
  onSaying: (text: string) => void;
  onMuted: (muted: boolean) => void;
  /** 0..1 mic level while listening. */
  onLevel: (level: number) => void;
};

type Turn = { before: Set<string>; replyId?: string; cursor: number; done: boolean };
type Queued = { text: string; audio: Promise<string | null> };

/**
 * A hands-free conversation loop: listen until the speaker pauses, transcribe with Hermes, send it
 * as an ordinary message (so the chat keeps the text), then speak the reply sentence by sentence
 * as it streams, in the bot's own TTS voice, and listen again. `tap()` cuts a reply off.
 */
export class VoiceSession {
  private phase: VoicePhase = "starting";
  private alive = true;
  private paused = false;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private noReply: ReturnType<typeof setTimeout> | null = null;
  private vad: VadState = createVad();
  private turn: Turn | null = null;
  private queue: Queued[] = [];
  private fetchChain: Promise<unknown> = Promise.resolve();
  private player: AudioPlayer | null = null;
  private playing = false;
  /** Bumped on barge-in and exit so speech that was still being fetched is dropped. */
  private generation = 0;
  private clip = 0;

  constructor(private io: VoiceIO) {}

  async start() {
    trace("checking microphone permission");
    const granted = await ensureMicPermission();
    trace(`microphone permission: ${granted ? "granted" : "not granted"}`);
    if (!this.alive) return;
    if (!granted) {
      this.io.toast(MIC_OFF_MESSAGE, "warn");
      this.setPaused(true);
      return this.setPhase("paused");
    }
    // Play-and-record for the whole session with replies on the loudspeaker: no audio session
    // switching (and no dead air) between listening and speaking.
    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
      shouldRouteThroughEarpiece: false,
      interruptionMode: "doNotMix",
    }).catch(() => undefined);
    trace("audio session ready");
    haptic.press();
    await this.listen();
  }

  dispose() {
    this.alive = false;
    if (this.noReply) clearTimeout(this.noReply);
    this.stopPlayback();
    void this.stopRecorder().then(() =>
      setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true, interruptionMode: "mixWithOthers" }).catch(
        () => undefined,
      ),
    );
  }

  /** The orb: while listening, "I'm done, send it"; while the bot works or talks, cut it off. */
  tap() {
    if (this.phase === "listening") return void this.endTurn();
    if (this.phase === "speaking" || this.phase === "thinking") {
      haptic.press();
      this.stopPlayback();
      if (this.io.running()) this.io.interrupt();
      this.turn = null;
      this.io.onSaying("");
      return void this.listen();
    }
    if (this.phase === "paused") {
      this.setPaused(false);
      void this.listen();
    }
  }

  /** Mute the mic (the bot can still finish speaking); unmuting listens again. */
  togglePause() {
    haptic.tap();
    this.setPaused(!this.paused);
    if (this.paused) {
      if (this.phase === "listening") {
        void this.stopRecorder();
        this.setPhase("paused");
      }
    } else if (this.phase === "paused") {
      void this.listen();
    }
  }

  /** The chat changed: speak any newly finished sentences of the reply to our last message. */
  update() {
    const turn = this.turn;
    if (!turn || turn.done) return;
    const items = this.io.items();
    const reply = turn.replyId
      ? items.find((item) => item.id === turn.replyId)
      : items.find((item) => item.kind === "assistant" && !turn.before.has(item.id));
    if (turn.replyId && !reply) {
      // Replaced by a transcript reload: don't pick up the copy and read it twice.
      turn.done = true;
      return this.settle();
    }
    if (reply?.kind !== "assistant") return;
    turn.replyId = reply.id;
    const final = !reply.streaming;
    const { sentences, next } = takeSentences(reply.text, turn.cursor, final);
    turn.cursor = next;
    for (const sentence of sentences) this.speak(sentence);
    if (final) {
      turn.done = true;
      if (reply.status === "error") haptic.warn();
      this.settle();
    }
  }

  private setPhase(phase: VoicePhase) {
    this.phase = phase;
    this.io.onPhase(phase);
  }

  private setPaused(paused: boolean) {
    this.paused = paused;
    this.io.onMuted(paused);
  }

  private stopTicker() {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    this.io.onLevel(0);
  }

  private async stopRecorder() {
    this.stopTicker();
    if (this.io.recorder.isRecording) await this.io.recorder.stop().catch(() => undefined);
  }

  private stopPlayback() {
    this.generation += 1;
    this.queue = [];
    this.fetchChain = Promise.resolve();
    this.player?.pause();
    this.player?.remove();
    this.player = null;
    this.playing = false;
  }

  private query() {
    return `?profile=${encodeURIComponent(this.io.profile())}`;
  }

  private async listen(): Promise<void> {
    if (!this.alive) return;
    if (this.paused) return this.setPhase("paused");
    const { recorder } = this.io;
    try {
      this.vad = createVad(this.vad.floorDb);
      trace("preparing recorder");
      await recorder.prepareToRecordAsync();
      if (!this.alive || this.paused) return;
      recorder.record();
      trace("recording");
      this.setPhase("listening");
      this.stopTicker();
      this.ticker = setInterval(() => this.tick(), TICK_MS);
    } catch (error) {
      trace(`microphone failed: ${String(error)}`);
      this.io.toast(this.io.errorText(error, "Couldn't start the microphone"), "error");
      this.setPaused(true);
      this.setPhase("paused");
    }
  }

  private tick() {
    const status = this.io.recorder.getStatus();
    const step = stepVad(this.vad, status.metering, TICK_MS);
    this.vad = step.state;
    const db = typeof status.metering === "number" ? status.metering : -160;
    this.io.onLevel(Math.max(0, Math.min(1, (db - step.state.floorDb) / 40)));
    if (step.event === "end") void this.endTurn();
    else if (step.event === "idle") void this.stopRecorder().then(() => this.listen());
  }

  private async endTurn() {
    if (this.phase !== "listening") return;
    this.setPhase("transcribing");
    await this.stopRecorder();
    haptic.tap();
    const text = await this.transcribe(this.io.recorder.uri);
    if (!this.alive) return;
    if (!text) return this.listen();
    this.io.onHeard(text);
    this.io.onSaying("");
    const before = new Set(this.io.items().filter((item) => item.kind === "assistant").map((item) => item.id));
    const turn: Turn = { before, cursor: 0, done: false };
    this.turn = turn;
    this.setPhase("thinking");
    if (this.noReply) clearTimeout(this.noReply);
    this.noReply = setTimeout(() => {
      if (this.turn === turn && !turn.replyId && !this.io.running()) {
        turn.done = true;
        this.settle();
      }
    }, NO_REPLY_MS);
    try {
      await this.io.send(text);
    } catch {
      // The chat reports send failures itself.
    }
  }

  private async transcribe(uri: string | null) {
    if (!uri) return "";
    try {
      const mime = Platform.OS === "web" ? "audio/webm" : "audio/mp4";
      const dataUrl = await pickedFileDataUrl({ uri, mimeType: mime });
      const result = await this.io.get<{ transcript?: string }>(`/api/audio/transcribe${this.query()}`, {
        method: "POST",
        body: JSON.stringify({ data_url: dataUrl, mime_type: mime }),
      });
      return (result.transcript ?? "").trim();
    } catch (error) {
      this.io.toast(this.io.errorText(error, "Couldn't transcribe that"), "error");
      return "";
    }
  }

  private speak(text: string) {
    const gen = this.generation;
    const audio = this.fetchChain.then(async () => {
      if (gen !== this.generation) return null;
      try {
        const result = await this.io.get<{ data_url: string }>(`/api/audio/speak${this.query()}`, {
          method: "POST",
          body: JSON.stringify({ text }),
        });
        if (gen !== this.generation) return null;
        this.clip += 1;
        return playableUri(result.data_url, `hermes-voice-${this.clip % 8}`);
      } catch (error) {
        if (gen === this.generation) this.io.toast(this.io.errorText(error, "Couldn't speak the reply"), "error");
        return null;
      }
    });
    // One synthesis at a time, in order: the next sentence renders while this one plays.
    this.fetchChain = audio;
    this.queue.push({ text, audio });
    void this.playNext();
  }

  private async playNext(): Promise<void> {
    if (this.playing) return;
    const next = this.queue.shift();
    if (!next) return this.settle();
    this.playing = true;
    const gen = this.generation;
    this.setPhase("speaking");
    this.io.onSaying(next.text);
    const uri = await next.audio;
    if (gen !== this.generation || !this.alive) return;
    if (!uri) {
      this.playing = false;
      return this.playNext();
    }
    const clip = createAudioPlayer({ uri });
    this.player = clip;
    clip.addListener("playbackStatusUpdate", (status) => {
      if (!status.didJustFinish || this.player !== clip) return;
      clip.remove();
      this.player = null;
      this.playing = false;
      void this.playNext();
    });
    clip.play();
  }

  /** Nothing left to say: listen again once the reply is complete, else keep waiting for more. */
  private settle() {
    if (this.playing || this.queue.length) return;
    if (this.turn && !this.turn.done) {
      if (this.phase === "speaking") this.setPhase("thinking");
      return;
    }
    this.turn = null;
    if (this.noReply) clearTimeout(this.noReply);
    if (this.phase === "thinking" || this.phase === "speaking") void this.listen();
  }
}
