import type { TimelineItem } from "@/features/chat/chatReducer";

type Listener = (status: { didJustFinish: boolean }) => void;
const players: { uri: string; play: jest.Mock; pause: jest.Mock; remove: jest.Mock; finish: () => void }[] = [];

jest.mock("expo-audio", () => ({
  getRecordingPermissionsAsync: jest.fn(async () => ({ granted: false, status: "undetermined" })),
  requestRecordingPermissionsAsync: jest.fn(async () => ({ granted: true })),
  setAudioModeAsync: jest.fn(async () => undefined),
  createAudioPlayer: jest.fn(({ uri }: { uri: string }) => {
    let listener: Listener = () => undefined;
    const player = {
      uri,
      play: jest.fn(),
      pause: jest.fn(),
      remove: jest.fn(),
      addListener: (_: string, fn: Listener) => (listener = fn),
      finish: () => listener({ didJustFinish: true }),
    };
    players.push(player);
    return player;
  }),
}));
jest.mock("@/features/chat/fileData", () => ({
  pickedFileDataUrl: jest.fn(async () => "data:audio/mp4;base64,AAAA"),
  playableUri: jest.fn((_: string, name: string) => `file:///${name}`),
}));
jest.mock("@/ui/primitives", () => ({ haptic: { tap: jest.fn(), press: jest.fn(), warn: jest.fn() } }));

// eslint-disable-next-line import/first
import { VoiceSession, type VoicePhase } from "@/features/voice/voiceSession";

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

function setup() {
  let items: TimelineItem[] = [{ kind: "assistant", id: "old", text: "Earlier reply.", reasoning: "", activity: [], streaming: false }];
  let running = false;
  const phases: VoicePhase[] = [];
  const recorder = {
    isRecording: false,
    uri: "file:///rec.m4a",
    prepareToRecordAsync: jest.fn(async () => undefined),
    record: jest.fn(() => void (recorder.isRecording = true)),
    stop: jest.fn(async () => void (recorder.isRecording = false)),
    getStatus: jest.fn(() => ({ metering: -60 })),
  };
  const spoken: string[] = [];
  const get = jest.fn(async (path: string, init?: RequestInit) => {
    if (path.startsWith("/api/audio/transcribe")) return { transcript: "What's the weather?" };
    spoken.push(JSON.parse(String(init?.body)).text);
    return { data_url: "data:audio/mpeg;base64,AAAA" };
  });
  const send = jest.fn(async () => {
    running = true;
  });
  const interrupt = jest.fn();
  const session = new VoiceSession({
    recorder: recorder as never,
    get: get as never,
    send,
    interrupt,
    toast: jest.fn(),
    errorText: (_e, fallback) => fallback,
    profile: () => "cto",
    items: () => items,
    running: () => running,
    onPhase: (phase) => phases.push(phase),
    onHeard: jest.fn(),
    onSaying: jest.fn(),
    onMuted: jest.fn(),
    onLevel: jest.fn(),
  });
  const reply = (text: string, streaming: boolean) => {
    items = [...items.filter((item) => item.id !== "r1"), { kind: "assistant", id: "r1", text, reasoning: "", activity: [], streaming }];
    running = streaming;
    session.update();
  };
  return { session, recorder, get, send, interrupt, phases, spoken, reply };
}

beforeEach(() => {
  players.length = 0;
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());

describe("VoiceSession", () => {
  it("sends what you said and speaks the streamed reply sentence by sentence, then listens again", async () => {
    const t = setup();
    await t.session.start();
    expect(t.phases.at(-1)).toBe("listening");

    t.session.tap(); // done talking
    await flush();
    expect(t.send).toHaveBeenCalledWith("What's the weather?");
    expect(t.phases.at(-1)).toBe("thinking");

    t.reply("It's sunny and warm in the city today. Highs near", true);
    await flush();
    expect(t.spoken).toEqual(["It's sunny and warm in the city today."]);
    expect(t.phases.at(-1)).toBe("speaking");
    expect(players).toHaveLength(1);

    t.reply("It's sunny and warm in the city today. Highs near 25 degrees.", false);
    await flush();
    expect(t.spoken).toEqual(["It's sunny and warm in the city today.", "Highs near 25 degrees."]);

    players[0].finish();
    await flush();
    expect(players).toHaveLength(2);
    expect(t.recorder.record).toHaveBeenCalledTimes(1);

    players[1].finish();
    await flush();
    expect(t.phases.at(-1)).toBe("listening");
    expect(t.recorder.record).toHaveBeenCalledTimes(2);
    t.session.dispose();
  });

  it("never re-reads earlier replies", async () => {
    const t = setup();
    await t.session.start();
    t.session.tap();
    await flush();
    t.session.update();
    await flush();
    expect(t.spoken).toEqual([]);
    t.session.dispose();
  });

  it("tapping while the bot talks stops it and listens", async () => {
    const t = setup();
    await t.session.start();
    t.session.tap();
    await flush();
    t.reply("Here is a long answer that keeps going for a while. And more.", true);
    await flush();
    expect(t.phases.at(-1)).toBe("speaking");

    t.session.tap();
    await flush();
    expect(players[0].remove).toHaveBeenCalled();
    expect(t.interrupt).toHaveBeenCalled();
    expect(t.phases.at(-1)).toBe("listening");
    t.session.dispose();
  });

  it("goes back to listening when a message gets no reply", async () => {
    const t = setup();
    t.send.mockImplementation(async () => undefined);
    await t.session.start();
    t.session.tap();
    await flush();
    jest.advanceTimersByTime(8000);
    await flush();
    expect(t.phases.at(-1)).toBe("listening");
    t.session.dispose();
  });

  it("ends the turn by itself when you stop talking", async () => {
    const t = setup();
    await t.session.start();
    const levels = [...Array(5).fill(-60), ...Array(10).fill(-20), ...Array(12).fill(-60)];
    t.recorder.getStatus.mockImplementation(() => ({ metering: levels.shift() ?? -60 }));
    jest.advanceTimersByTime(2700);
    await flush();
    expect(t.send).toHaveBeenCalledWith("What's the weather?");
    t.session.dispose();
  });
});
