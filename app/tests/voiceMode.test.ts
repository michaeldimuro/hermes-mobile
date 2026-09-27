import { takeSentences } from "@/features/voice/speech";
import { createVad, stepVad, VAD_DEFAULTS, type VadEvent, type VadState } from "@/features/voice/vad";

describe("takeSentences", () => {
  it("speaks complete sentences as they stream in and holds back the unfinished one", () => {
    const first = takeSentences("Sure, I can look into that for you. Checking the dep", 0, false);
    expect(first.sentences).toEqual(["Sure, I can look into that for you."]);
    const text = "Sure, I can look into that for you. Checking the deploy logs now. Done";
    const second = takeSentences(text, first.next, false);
    expect(second.sentences).toEqual(["Checking the deploy logs now."]);
    expect(takeSentences(text, second.next, true).sentences).toEqual(["Done"]);
  });

  it("joins short sentences so each speech request carries a natural phrase", () => {
    const { sentences } = takeSentences("Yes. Okay. The build passed on main. ", 0, false);
    expect(sentences).toEqual(["Yes. Okay. The build passed on main."]);
  });

  it("never cuts inside a code block and doesn't read the code", () => {
    const text = "Here's the fix:\n\n```ts\nconst a = 1. b = 2;\n```\n\nThat should do it for the tests.";
    const partial = takeSentences(text.slice(0, 40), 0, false);
    expect(partial.sentences).toEqual([]);
    expect(takeSentences(text, 0, true).sentences).toEqual(["Here's the fix:\n (code omitted)", "That should do it for the tests."]);
  });

  it("drops MEDIA lines and markdown", () => {
    const { sentences } = takeSentences("I made **the chart** for you.\nMEDIA:/tmp/chart.png", 0, true);
    expect(sentences).toEqual(["I made the chart for you."]);
  });
});

describe("stepVad", () => {
  const run = (levels: number[], state: VadState = createVad()) => {
    let event: VadEvent = "none";
    for (const level of levels) {
      ({ state, event } = stepVad(state, level, 100));
      if (event !== "none") break;
    }
    return { state, event };
  };
  const quiet = (n: number) => Array(n).fill(-58);
  const talk = (n: number) => Array(n).fill(-22);

  it("ends the turn after speech followed by a pause", () => {
    const { event, state } = run([...quiet(10), ...talk(15), ...quiet(12)]);
    expect(state.speaking).toBe(true);
    expect(event).toBe("end");
  });

  it("keeps listening through short pauses between words", () => {
    expect(run([...quiet(5), ...talk(5), ...quiet(6), ...talk(5), ...quiet(3)]).event).toBe("none");
  });

  it("ignores a brief noise", () => {
    const { event, state } = run([...quiet(10), -20, ...quiet(20)]);
    expect(state.speaking).toBe(false);
    expect(event).toBe("none");
  });

  it("adapts to a noisy room", () => {
    const noisy = Array(40).fill(-38);
    const { state } = run(noisy);
    expect(state.speaking).toBe(false);
    expect(state.floorDb).toBeGreaterThan(-45);
  });

  it("reports idle when nobody speaks", () => {
    expect(run(quiet(VAD_DEFAULTS.idleMs / 100)).event).toBe("idle");
  });

  it("treats a missing reading as silence", () => {
    expect(stepVad(createVad(), undefined, 100).state.heardMs).toBe(0);
  });
});
