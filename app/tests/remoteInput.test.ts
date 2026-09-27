import { activeTab, click, displayHost, key, toPage, typing, wheel } from "@/features/browser/remoteInput";

const viewport = { width: 1280, height: 720 };

describe("toPage", () => {
  it("maps a touch on the fitted picture to page pixels", () => {
    // 1280x720 fitted into 390x600: scale 0.3047, letterboxed vertically.
    const box = { width: 390, height: 600 };
    const scale = 390 / 1280;
    const top = (600 - 720 * scale) / 2;
    expect(toPage(195, top + 360 * scale, box, viewport)).toEqual({ x: 640, y: 360 });
    expect(toPage(0, top, box, viewport)).toEqual({ x: 0, y: 0 });
  });

  it("maps against the shrunken stage when the keyboard is up (bars left and right)", () => {
    // A 460x620 page shown in a 460x367 stage: scale 367/620, centered horizontally.
    const page = { width: 460, height: 620 };
    const stage = { width: 460, height: 367 };
    const scale = 367 / 620;
    const left = (460 - 460 * scale) / 2;
    // The Next button at page (380, 300) is drawn at left + 380*scale, 300*scale.
    expect(toPage(left + 380 * scale, 300 * scale, stage, page)).toEqual({ x: 380, y: 300 });
    expect(toPage(10, 100, stage, page)).toBeNull();
  });

  it("ignores touches on the letterbox", () => {
    expect(toPage(100, 5, { width: 390, height: 600 }, viewport)).toBeNull();
  });
});

describe("typing", () => {
  const texts = (messages: ReturnType<typeof typing>) =>
    messages.filter((m) => m.eventType === "keyDown").map((m) => m.text);

  it("types what was added", () => {
    expect(texts(typing("", "Ab1!"))).toEqual(["A", "b", "1", "!"]);
  });

  it("marks capitals as shifted so sites that check keys see a real shift", () => {
    expect(typing("", "A")[0]).toMatchObject({ key: "A", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 8 });
  });

  it("backspaces to the common prefix, then types the rest (autofill, autocorrect)", () => {
    expect(texts(typing("hunter", "hunt3r2"))).toEqual(["\b", "\b", "3", "r", "2"]);
  });

  it("handles emoji as one character", () => {
    expect(texts(typing("a😀", "a"))).toEqual(["\b"]);
  });

  it("turns a newline into Enter", () => {
    expect(texts(typing("", "x\n"))).toEqual(["x", "\r"]);
  });
});

it("sends Enter, Tab and Backspace with the codes Chrome needs", () => {
  expect(key("Enter")[0]).toMatchObject({ eventType: "keyDown", text: "\r", windowsVirtualKeyCode: 13 });
  expect(key("Tab")[0]).toMatchObject({ text: "\t", windowsVirtualKeyCode: 9 });
  expect(key("Escape")[0].text).toBeUndefined();
});

it("clicks with move, press, release", () => {
  expect(click(10, 20).map((m) => m.eventType)).toEqual(["mouseMoved", "mousePressed", "mouseReleased"]);
  expect(wheel(1, 2, 0, 300)).toMatchObject({ eventType: "mouseWheel", deltaY: 300 });
});

it("reads the active tab and a short host", () => {
  const tab = activeTab({ tabs: [{ active: false, title: "a" }, { active: true, title: "Log in", url: "https://www.bitbucket.org/x" }] });
  expect(tab).toEqual({ title: "Log in", url: "https://www.bitbucket.org/x" });
  expect(displayHost(tab!.url)).toBe("bitbucket.org");
});
