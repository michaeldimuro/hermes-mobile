import type { ProfileRow, SessionListRow } from "@/lib/gateway/types";
import {
  DESKTOP_HELD,
  deleteErrorText,
  groupConversations,
  hasActivity,
  inboxItems,
  sessionEmptyTitle,
  sessionKey,
  START_HEADER,
  visibleSessions,
} from "@/features/inbox/grouping";
import { contrastRatio, readableInk } from "@/features/inbox/format";
import type { Conversation } from "@/features/inbox/useConversations";

const bot = (name: string, title: string, messages: number, at = 0, description = ""): Conversation => ({
  kind: "bot",
  key: `bot:${name}`,
  title,
  preview: messages ? "last reply" : description || "Start a conversation",
  at,
  bot: { name, description, canonical_session: messages ? { id: `s-${name}`, message_count: messages } : null } as ProfileRow,
});

const group = (id: string, title: string, at: number): Conversation => ({
  kind: "group",
  key: `hosted:${id}`,
  title,
  preview: "You: hi",
  at,
  origin: "hosted",
  roomId: id,
  members: ["alpha", "beta"],
});

const list: Conversation[] = [
  bot("zed", "Zed", 0, 0, "Release manager"),
  bot("alpha", "Alpha", 4, 1_000),
  group("r1", "Launch room", 3_000),
  bot("beta", "beta", 0, 0, "Researcher"),
  bot("gamma", "Gamma", 2, 2_000),
];

describe("conversation grouping", () => {
  it("treats group chats and bots with messages as activity", () => {
    expect(list.map(hasActivity)).toEqual([false, true, true, false, true]);
  });

  it("orders activity newest first and starters alphabetically, case-insensitive", () => {
    const { active, starters } = groupConversations(list, "");
    expect(active.map((item) => item.title)).toEqual(["Launch room", "Gamma", "Alpha"]);
    expect(starters.map((item) => item.title)).toEqual(["beta", "Zed"]);
  });

  it("flattens with a single header and separators only between rows of the same section", () => {
    const items = inboxItems(list, "");
    expect(items.map((item) => item.type)).toEqual(["conversation", "conversation", "conversation", "header", "starter", "starter"]);
    expect(items.find((item) => item.type === "header")).toMatchObject({ title: START_HEADER });
    expect(items.map((item) => ("separator" in item ? item.separator : null))).toEqual([true, true, false, null, true, false]);
  });

  it("filters both groups by search, including bot descriptions", () => {
    expect(inboxItems(list, "research").map((item) => item.key)).toEqual(["header:start", "bot:beta"]);
    expect(inboxItems(list, " LAUNCH ").map((item) => item.key)).toEqual(["hosted:r1"]);
  });

  it("hides the header when no starters remain", () => {
    const items = inboxItems(list, "alpha");
    expect(items.some((item) => item.type === "header")).toBe(false);
    expect(items.map((item) => item.key)).toEqual(["hosted:r1", "bot:alpha"]);
  });

  it("returns nothing for an empty list", () => {
    expect(inboxItems([], "")).toEqual([]);
  });
});

describe("session list helpers", () => {
  const rows: SessionListRow[] = [
    { id: "a", profile: "alpha", title: "Budget", preview: "numbers" },
    { id: "b", title: "Notes", preview: "**bold** thing" },
    { id: "c", profile: "beta", title: "Draft" },
  ];

  it("keys rows by profile, defaulting to default", () => {
    expect(rows.map(sessionKey)).toEqual(["alpha:a", "default:b", "beta:c"]);
  });

  it("drops hidden rows, applies renames, then searches the new title", () => {
    const shown = visibleSessions(rows, { hidden: new Set(["beta:c"]), titles: { "alpha:a": "Taxes" }, query: "tax" });
    expect(shown).toEqual([{ ...rows[0], title: "Taxes" }]);
    expect(visibleSessions(rows, { hidden: new Set(), titles: {}, query: "bold" }).map((row) => row.id)).toEqual(["b"]);
    expect(visibleSessions(rows, { hidden: new Set(), titles: {}, query: "" })).toHaveLength(3);
  });

  it("names the filter in empty copy", () => {
    expect(sessionEmptyTitle("automations", false)).toBe("No automation runs yet");
    expect(sessionEmptyTitle("all", false)).toBe("No sessions yet");
    expect(sessionEmptyTitle("automations", true)).toBe("No matches");
  });

  it("explains a session held open elsewhere", () => {
    expect(deleteErrorText(new Error("cannot delete an active session"))).toBe(DESKTOP_HELD);
    expect(deleteErrorText(new Error("session not found"))).toBe("session not found");
    expect(deleteErrorText(undefined)).toBe("Could not delete the session");
  });
});

describe("delete button ink", () => {
  it("keeps white on the light red and switches to black on the pale dark-theme red", () => {
    expect(readableInk("#DC2626")).toBe("#FFFFFF");
    expect(readableInk("#F26D6D")).toBe("#000000");
    expect(contrastRatio("#F26D6D", readableInk("#F26D6D"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#000", "#FFF")).toBeCloseTo(21, 5);
  });
});
