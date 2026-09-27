import {
  applySuggestion,
  detectTrigger,
  mentionedHandles,
  parseSlash,
  rankMatches,
  skillInvocationText,
} from "@/features/chat/composerText";

describe("detectTrigger", () => {
  it("opens the slash picker only for the first token", () => {
    expect(detectTrigger("/syn")).toEqual({ kind: "/", query: "syn", start: 0, end: 4 });
    expect(detectTrigger("/")).toMatchObject({ kind: "/", query: "" });
    expect(detectTrigger("/synergy-social now")).toBeNull();
    expect(detectTrigger("see /docs")).toBeNull();
  });

  it("opens the mention picker at the start of any word", () => {
    expect(detectTrigger("@")).toEqual({ kind: "@", query: "", start: 0, end: 1 });
    expect(detectTrigger("ask @rese")).toEqual({ kind: "@", query: "rese", start: 4, end: 9 });
    expect(detectTrigger("mail me@example")).toBeNull();
    expect(detectTrigger("ask @rese and", 9)).toMatchObject({ kind: "@", query: "rese" });
  });
});

describe("applySuggestion", () => {
  it("replaces the trigger span and leaves the cursor after a space", () => {
    const trigger = detectTrigger("ask @rese")!;
    expect(applySuggestion("ask @rese", trigger, "@researcher")).toEqual({ text: "ask @researcher ", cursor: 16 });
    const mid = detectTrigger("ask @re to check", 7)!;
    expect(applySuggestion("ask @re to check", mid, "@researcher").text).toBe("ask @researcher to check");
  });
});

describe("parseSlash / mentionedHandles / rankMatches", () => {
  it("splits slash name and argument", () => {
    expect(parseSlash("/synergy-social-content  make it punchy ")).toEqual({ name: "synergy-social-content", arg: "make it punchy" });
    expect(parseSlash("/help")).toEqual({ name: "help", arg: "" });
    expect(parseSlash("hello /help")).toBeNull();
  });

  it("finds unique handles", () => {
    expect(mentionedHandles("@qa and @reviewer, then @qa again; mail a@b")).toEqual(["qa", "reviewer"]);
  });

  it("ranks prefix, word-start, substring, then description matches", () => {
    const items = [
      { name: "social-media", d: "" },
      { name: "media-social", d: "" },
      { name: "antisocial", d: "" },
      { name: "blog", d: "social posts" },
      { name: "weather", d: "" },
    ];
    expect(rankMatches(items, "soc", (i) => [i.name, i.d]).map((i) => i.name)).toEqual([
      "social-media",
      "media-social",
      "antisocial",
      "blog",
    ]);
  });
});

describe("skillInvocationText", () => {
  it("projects a scaffolded skill turn back to the typed invocation", () => {
    const text =
      '[IMPORTANT: The user has invoked the "synergy-social-content" skill. The full skill content is loaded below.]\n\n# Body…\n\n' +
      "The user has provided the following instruction alongside the skill invocation: make it  punchy\n\n[Runtime note: x]";
    expect(skillInvocationText(text)).toBe("/synergy-social-content make it punchy");
    expect(skillInvocationText("plain words")).toBeNull();
  });
});
