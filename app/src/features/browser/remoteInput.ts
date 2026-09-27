/**
 * Messages for agent-browser's viewport stream (the bot's browser, relayed by the hermes-mobile plugin).
 * The shapes match agent-browser's own dashboard: keys carry `text` + `windowsVirtualKeyCode`, or Chrome
 * ignores Enter/Backspace/Tab.
 */
export type StreamMessage = Record<string, unknown> & { type: string };
export type Viewport = { width: number; height: number };
export type Box = { width: number; height: number };

/** Where a touch on the picture lands on the page (the picture is the viewport scaled to fit `box`). */
export function toPage(x: number, y: number, box: Box, viewport: Viewport) {
  const scale = Math.min(box.width / viewport.width, box.height / viewport.height);
  const offsetX = (box.width - viewport.width * scale) / 2;
  const offsetY = (box.height - viewport.height * scale) / 2;
  const px = Math.round((x - offsetX) / scale);
  const py = Math.round((y - offsetY) / scale);
  if (px < 0 || py < 0 || px > viewport.width || py > viewport.height) return null;
  return { x: px, y: py };
}

export function click(x: number, y: number): StreamMessage[] {
  const base = { type: "input_mouse", x, y, button: "left", clickCount: 1, modifiers: 0 };
  return [
    { ...base, eventType: "mouseMoved", button: "none", clickCount: 0 },
    { ...base, eventType: "mousePressed" },
    { ...base, eventType: "mouseReleased" },
  ];
}

export function wheel(x: number, y: number, deltaX: number, deltaY: number): StreamMessage {
  return { type: "input_mouse", eventType: "mouseWheel", x, y, button: "none", clickCount: 0, deltaX, deltaY, modifiers: 0 };
}

const SPECIAL = {
  Enter: { text: "\r", keyCode: 13 },
  Tab: { text: "\t", keyCode: 9 },
  Backspace: { text: "\b", keyCode: 8 },
  Escape: { keyCode: 27 },
} as const;
export type SpecialKey = keyof typeof SPECIAL;

export function key(name: SpecialKey): StreamMessage[] {
  const { keyCode } = SPECIAL[name];
  const text = "text" in SPECIAL[name] ? (SPECIAL[name] as { text: string }).text : undefined;
  return [
    { type: "input_keyboard", eventType: "keyDown", key: name, code: name, text, windowsVirtualKeyCode: keyCode, modifiers: 0 },
    { type: "input_keyboard", eventType: "keyUp", key: name, code: name, windowsVirtualKeyCode: keyCode, modifiers: 0 },
  ];
}

function char(ch: string): StreamMessage[] {
  const upper = ch.toUpperCase();
  const letter = /^[a-z]$/i.test(ch);
  const digit = /^[0-9]$/.test(ch);
  const code = letter ? `Key${upper}` : digit ? `Digit${ch}` : "";
  const keyCode = letter || digit ? upper.charCodeAt(0) : 0;
  const modifiers = letter && ch === upper ? 8 : 0;
  return [
    { type: "input_keyboard", eventType: "keyDown", key: ch, code, text: ch, windowsVirtualKeyCode: keyCode, modifiers },
    { type: "input_keyboard", eventType: "keyUp", key: ch, code, windowsVirtualKeyCode: keyCode, modifiers },
  ];
}

/**
 * The phone's text box mirrors what's been typed into the focused field. Turn an edit of that box into
 * keystrokes: backspace to the common prefix, then type the rest (covers typing, deleting, paste and
 * password-manager autofill).
 */
export function typing(before: string, after: string): StreamMessage[] {
  const a = Array.from(before);
  const b = Array.from(after);
  let same = 0;
  while (same < a.length && same < b.length && a[same] === b[same]) same++;
  const out: StreamMessage[] = [];
  for (let i = same; i < a.length; i++) out.push(...key("Backspace"));
  for (const ch of b.slice(same)) out.push(...(ch === "\n" ? key("Enter") : char(ch)));
  return out;
}

/** The active tab's title and address, from the stream's `tabs` message. */
export function activeTab(message: { tabs?: { active?: boolean; title?: string | null; url?: string }[] }) {
  const tab = message.tabs?.find((t) => t.active) ?? message.tabs?.[0];
  return tab ? { title: tab.title || "", url: tab.url || "" } : null;
}

/** A host to show under the title ("bitbucket.org"), or the raw address when it isn't a URL. */
export function displayHost(url: string) {
  const match = /^https?:\/\/([^/?#]+)/i.exec(url);
  return match ? match[1].replace(/^www\./, "") : url.slice(0, 60);
}
