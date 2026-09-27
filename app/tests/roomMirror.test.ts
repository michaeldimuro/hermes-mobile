import {
  assistantReplies,
  buildRoomTimeline,
  candidatesFromSessions,
  collectSpeakerLabels,
  dayLabel,
  mergeByTime,
  mergeSessionReplies,
  memberSessionTitles,
  normalizeText,
  parseDeltaLines,
  parseGroupsEnvelope,
  readGroupsMeta,
  reconstructEarlier,
  resolveTruncated,
  summarizeEnvelope,
  toSessionRows,
  truncatedFallback,
  turnReplies,
  type MirrorEntry,
} from "@/features/rooms/roomMirror";

const T0 = new Date(2026, 8, 24, 10, 0, 0).getTime();
const MARK = "… [truncated]";

function prompt(lines: string[], group = "C Suite", self = "ceo") {
  return [
    `[Group chat: "${group}"] You are @${self}, one participant in a group chat with @cfo, @cto and the user.`,
    "",
    "New messages in the room since your last turn (oldest first):",
    ...lines.map((l) => `  ${l}`),
    "",
    "Rules for this room:",
    "- Reply with ONE conversational message ONLY if you have something new worth adding.",
  ].join("\n");
}

const v3 = {
  version: 3,
  updatedAt: T0 + 99_000,
  deleted: { "id:gone-1": T0 },
  rooms: {
    "id:rm-1": {
      name: "C Suite",
      roomId: "rm-1",
      revision: 64,
      omitted: 26,
      members: [
        { name: "cto", handle: "cto", connectionId: "local", connectionKind: "local", connectionLabel: "This device" },
        { name: "ceo", handle: "chief", connectionKind: "local" },
        { name: "far", connectionKind: "remote", remoteSource: true },
        "junk",
      ],
      log: [
        { id: "a", from: { kind: "user", name: "You" }, text: "Hello @everyone", at: T0, thread: "t1" },
        { id: "b", from: { kind: "member", name: "ceo", source: "This device" }, text: "Great to have", at: T0 + 5000, thread: "t1" },
        { id: "c", from: { kind: "member", name: "ceo" }, text: `Long start of reply${MARK}`, at: T0 + 60_000, thread: "t1", truncated: true },
        { bad: true },
      ],
    },
    "id:gone-1": { name: "Deleted room", roomId: "gone-1", members: [], log: [] },
    "id:rm-2": { name: "Empty", roomId: "rm-2", members: [], log: [] },
  },
};

describe("readGroupsMeta", () => {
  it("reads envelope and revision from the default profile", () => {
    const res = readGroupsMeta([
      { name: "ceo", ui_meta: {} },
      { name: "default", ui_meta: { "hermes-bots-groups": v3 }, ui_meta_revisions: { "hermes-bots-groups": 64 } },
    ]);
    expect(res.envelope).toBe(v3);
    expect(res.revision).toBe(64);
  });
  it("falls back to the is_default row and tolerates missing data", () => {
    expect(readGroupsMeta([{ name: "main", is_default: true, ui_meta: null }])).toEqual({ envelope: null, revision: null });
    expect(readGroupsMeta(undefined)).toEqual({ envelope: null, revision: null });
  });
});

describe("parseGroupsEnvelope", () => {
  it("parses v3 rooms, skipping tombstones and malformed entries", () => {
    const env = parseGroupsEnvelope(v3);
    expect(env.version).toBe(3);
    expect(env.rooms.map((r) => r.roomId)).toEqual(["rm-1", "rm-2"]);
    const room = env.rooms[0];
    expect(room).toMatchObject({ name: "C Suite", revision: 64, omitted: 26, hasRoomId: true });
    expect(room.members.map((m) => [m.name, m.handle, m.local])).toEqual([
      ["cto", "cto", true],
      ["ceo", "chief", true],
      ["far", "far", false],
    ]);
    expect(room.log).toHaveLength(3);
    expect(room.log[1].from).toEqual({ kind: "member", name: "ceo", source: "This device" });
    expect(room.log[2].truncated).toBe(true);
  });
  it("accepts a JSON string and garbage", () => {
    expect(parseGroupsEnvelope(JSON.stringify(v3)).rooms).toHaveLength(2);
    expect(parseGroupsEnvelope("{nope").rooms).toEqual([]);
    expect(parseGroupsEnvelope(null).rooms).toEqual([]);
  });
  it("handles legacy name-keyed rooms without roomId", () => {
    const env = parseGroupsEnvelope({
      version: 1,
      rooms: {
        Legacy: { members: [{ name: "cfo" }], log: [{ from: { kind: "member" }, text: "hi", at: 5 }] },
        Gone: { name: "Gone", members: [], log: [] },
      },
      deleted: { Gone: 1 },
    });
    expect(env.rooms).toHaveLength(1);
    expect(env.rooms[0]).toMatchObject({ roomId: "Legacy", name: "Legacy", hasRoomId: false });
    expect(env.rooms[0].log[0]).toMatchObject({ id: "Legacy:0:5", from: { kind: "member", name: "Bot" } });
  });
  it("does not let a name tombstone hide a room that has its own id", () => {
    const env = parseGroupsEnvelope({ version: 3, rooms: { "id:x": { name: "Same", roomId: "x", log: [] } }, deleted: { "name:Same": 1 } });
    expect(env.rooms).toHaveLength(1);
  });
});

describe("summaries", () => {
  it("sorts by last activity and uses envelope time for empty rooms", () => {
    const list = summarizeEnvelope(parseGroupsEnvelope(v3));
    expect(list.map((r) => r.roomId)).toEqual(["rm-2", "rm-1"]);
    expect(list[0].updatedAt).toBe(T0 + 99_000);
    expect(list[1].last).toEqual({ from: "ceo", kind: "member", text: "Long start of reply", at: T0 + 60_000 });
    expect(list[1].members).toContainEqual({ name: "ceo", handle: "chief" });
  });
});

describe("text helpers", () => {
  it("normalises whitespace and strips the truncation mark", () => {
    expect(normalizeText(`  a\n\n b   c${MARK}`)).toBe("a b c");
    expect(truncatedFallback(`abc ${MARK}`)).toBe("abc…(truncated)");
  });
  it("builds session titles per thread plus the pre-thread title", () => {
    const room = parseGroupsEnvelope(v3).rooms[0];
    expect(memberSessionTitles(room)).toEqual(["Group: rm-1 · t1", "Group: rm-1"]);
  });
});

describe("session rows", () => {
  const rows = toSessionRows([
    { role: "user", content: prompt(["You (user): Hello"]), timestamp: T0 / 1000 + 0.1 },
    { role: "assistant", content: "", timestamp: T0 / 1000 + 1 },
    { role: "tool", content: "{}", timestamp: T0 / 1000 + 2 },
    { role: "assistant", content: "Interim", timestamp: T0 / 1000 + 3 },
    { role: "assistant", content: [{ type: "text", text: "Final " }, { type: "text", text: "answer" }], timestamp: T0 / 1000 + 4 },
    { role: "user", content: prompt(["cfo: hi"]), timestamp: T0 / 1000 + 10 },
    { role: "assistant", content: "(pass)", timestamp: T0 / 1000 + 11 },
    { role: "assistant", content: "hidden", display_kind: "hidden", timestamp: 1 },
    { role: "assistant", content: "summary", display_content: "x", timestamp: 1 },
    { role: "user", content: "[CONTEXT COMPACTION] earlier turns", timestamp: 1 },
    "junk",
  ]);
  it("converts seconds to ms and drops hidden rows", () => {
    expect(rows).toHaveLength(7);
    expect(rows[0].at).toBe(T0 + 100);
    expect(rows[4].text).toBe("Final answer");
  });
  it("lists every real reply and one reply per turn", () => {
    expect(assistantReplies(rows, "ceo").map((c) => c.text)).toEqual(["Interim", "Final answer"]);
    expect(turnReplies(rows, "ceo").map((c) => c.text)).toEqual(["Final answer"]);
    expect(toSessionRows(null)).toEqual([]);
  });
});

describe("parseDeltaLines", () => {
  it("splits user, member, self and omitted lines, keeping multi-line bodies", () => {
    const text = prompt([
      "… 3 earlier room messages omitted since your last turn",
      "CEO (you) [This device]: my last point",
      "You (user): line one\nline two\n  if [ -d x ]; then\n  fi",
      "CFO [This device]: numbers: fine",
      "Chief Technology Officer: unsourced reply",
    ]);
    const labels = collectSpeakerLabels([text, prompt(["Chief Technology Officer [Studio]: x"])]);
    expect(labels).toEqual(expect.arrayContaining(["CEO", "CFO", "Chief Technology Officer"]));
    const lines = parseDeltaLines(text, labels);
    expect(lines.map((l) => [l.kind, l.label])).toEqual([
      ["note", ""],
      ["member", "CEO"],
      ["user", "You"],
      ["member", "CFO"],
      ["member", "Chief Technology Officer"],
    ]);
    expect(lines[2].text).toBe("line one\nline two\n  if [ -d x ]; then\n  fi");
    expect(lines[3].text).toBe("numbers: fine");
  });
  it("returns nothing for non-room prompts", () => {
    expect(parseDeltaLines("hello there")).toEqual([]);
  });
});

describe("resolveTruncated", () => {
  const log = parseGroupsEnvelope(v3).rooms[0].log;
  it("picks the same member's longer reply closest in time", () => {
    const full = resolveTruncated(log, [
      { from: { kind: "member", name: "cfo" }, text: "Long start of reply and more", at: T0 + 60_000 },
      { from: { kind: "member", name: "ceo" }, text: "Long  start of\nreply, far away", at: T0 + 60_000 + 11 * 60_000 },
      { from: { kind: "member", name: "ceo" }, text: "Long start of reply — older", at: T0 + 10_000 },
      { from: { kind: "member", name: "ceo" }, text: "Long start of\nreply — closest", at: T0 + 58_000 },
      { from: { kind: "member", name: "ceo" }, text: "Different text", at: T0 + 60_000 },
    ]);
    expect(full).toEqual({ c: "Long start of\nreply — closest" });
  });
  it("resolves truncated user messages from quoted prompt lines", () => {
    const userLog: MirrorEntry[] = [{ id: "u", from: { kind: "user", name: "You" }, text: `Please do the thing${MARK}`, at: T0, truncated: true }];
    expect(resolveTruncated(userLog, [{ from: { kind: "user", name: "You" }, text: "Please do the thing fully", at: T0 + 90 }])).toEqual({
      u: "Please do the thing fully",
    });
    expect(resolveTruncated(userLog, [])).toEqual({});
  });
});

describe("reconstructEarlier", () => {
  const log: MirrorEntry[] = [
    { id: "m1", from: { kind: "user", name: "You" }, text: "Current question", at: T0 + 100_000 },
    { id: "m2", from: { kind: "member", name: "ceo" }, text: "Current answer", at: T0 + 105_000 },
  ];
  it("rebuilds older bot replies and de-duplicated user lines", () => {
    const sessions = [
      {
        member: "ceo",
        rows: toSessionRows([
          { role: "user", content: prompt(["You (user): Kickoff", "cfo [This device]: noted"]), timestamp: (T0 + 1000) / 1000 },
          { role: "assistant", content: "CEO old reply", timestamp: (T0 + 5000) / 1000 },
          { role: "user", content: prompt(["You (user): Current question"]), timestamp: (T0 + 100_050) / 1000 },
          { role: "assistant", content: "Current answer", timestamp: (T0 + 105_000) / 1000 },
        ]),
      },
      {
        member: "cfo",
        rows: toSessionRows([
          { role: "user", content: prompt(["You (user): Kickoff"], "C Suite", "cfo"), timestamp: (T0 + 2000) / 1000 },
          { role: "assistant", content: "", timestamp: (T0 + 3000) / 1000 },
          { role: "assistant", content: "noted", timestamp: (T0 + 4000) / 1000 },
          { role: "user", content: prompt(["CEO [This device]: CEO old reply"], "C Suite", "cfo"), timestamp: (T0 + 6000) / 1000 },
          { role: "assistant", content: "(pass)", timestamp: (T0 + 7000) / 1000 },
        ]),
      },
    ];
    const { turns, userLines, replies } = candidatesFromSessions(sessions);
    expect(replies).toHaveLength(3);
    const earlier = reconstructEarlier(log, turns, userLines, "rm-1");
    expect(earlier.map((e) => [e.from.kind, e.from.name, e.text, e.at])).toEqual([
      ["user", "You", "Kickoff", T0 + 1000],
      ["member", "cfo", "noted", T0 + 4000],
      ["member", "ceo", "CEO old reply", T0 + 5000],
    ]);
    expect(earlier.every((e) => e.reconstructed && e.id.startsWith("earlier:rm-1:"))).toBe(true);
  });
  it("keeps a repeated user message sent far apart in time", () => {
    const lines = [
      { from: { kind: "user" as const, name: "You" }, text: "yes", at: T0 },
      { from: { kind: "user" as const, name: "You" }, text: "yes", at: T0 + 30 * 60_000 },
    ];
    expect(reconstructEarlier([], [], lines)).toHaveLength(2);
    expect(reconstructEarlier([], [], [lines[0], { ...lines[0], at: T0 + 500 }])).toHaveLength(1);
  });
});

describe("mergeSessionReplies", () => {
  const log: MirrorEntry[] = [
    { id: "u1", from: { kind: "user", name: "You" }, text: "Question", at: T0, thread: "t1" },
    { id: "m1", from: { kind: "member", name: "cfo" }, text: `Budget is ${MARK}`, at: T0 + 20_000, thread: "t1", truncated: true },
    { id: "u2", from: { kind: "user", name: "You" }, text: "Next", at: T0 + 600_000, thread: "t2" },
    { id: "m2", from: { kind: "member", name: "ceo" }, text: "Wrap up", at: T0 + 700_000, thread: "t2" },
  ];
  const rows = (member: string, list: [string, string, number, number?][]) =>
    turnReplies(
      toSessionRows(list.map(([role, content, at, id]) => ({ id, role, content, timestamp: at / 1000 }))),
      member,
    );

  it("inserts an in-range reply missing from the mirror, attributed and ordered", () => {
    const turns = rows("cto", [
      ["user", "prompt", T0 + 100],
      ["assistant", "Infra plan ready", T0 + 30_000, 42],
      ["user", "prompt", T0 + 610_000],
      ["assistant", "Second note", T0 + 650_000],
    ]);
    const merged = mergeSessionReplies(log, turns);
    expect(merged.map((e) => [e.id, e.from.name, e.text, e.thread])).toEqual([
      ["session:cto:42", "cto", "Infra plan ready", "t1"],
      ["session:cto:i3", "cto", "Second note", "t2"],
    ]);
    expect(mergeByTime(log, merged).map((e) => e.id)).toEqual(["u1", "m1", "session:cto:42", "u2", "session:cto:i3", "m2"]);
  });

  it("does not insert a duplicate of a (truncated) mirror entry close in time", () => {
    const turns = rows("cfo", [
      ["user", "prompt", T0 + 100],
      ["assistant", "Budget   is\nfine for Q4", T0 + 18_000, 7],
    ]);
    expect(mergeSessionReplies(log, turns)).toEqual([]);
    // Same text from another member, or far away in time, is a different message.
    expect(mergeSessionReplies(log, rows("cto", [["assistant", "Budget is fine", T0 + 20_000]]))).toHaveLength(1);
    expect(mergeSessionReplies(log, rows("cfo", [["assistant", "Budget is fine", T0 + 690_000]]))).toHaveLength(1);
  });

  it("treats identical text posted later as the same message, but keeps a genuine repeat", () => {
    const late: MirrorEntry[] = [
      ...log,
      { id: "m3", from: { kind: "member", name: "cto" }, text: "Deploy done", at: T0 + 690_000, thread: "t2" },
    ];
    // The desktop posted the reply ~11 minutes after the session stored it.
    expect(mergeSessionReplies(late, rows("cto", [["assistant", "Deploy done", T0 + 30_000]]))).toEqual([]);
    // Two identical session replies, one mirror entry: the second is a real repeat.
    const twice = rows("cto", [
      ["user", "p", T0 + 100],
      ["assistant", "Deploy done", T0 + 30_000],
      ["user", "p", T0 + 600_100],
      ["assistant", "Deploy done", T0 + 650_000],
    ]);
    expect(mergeSessionReplies(late, twice).map((e) => e.at)).toEqual([T0 + 30_000]);
  });

  it("skips (pass), empty and out-of-range replies", () => {
    const turns = rows("cmo", [
      ["user", "prompt", T0 + 100],
      ["assistant", "(pass)", T0 + 5_000],
      ["user", "prompt", T0 + 200_000],
      ["assistant", "   ", T0 + 205_000],
      ["user", "prompt", T0 - 60_000],
      ["assistant", "Before the mirror", T0 - 50_000],
      ["user", "prompt", T0 + 800_000],
      ["assistant", "After the mirror", T0 + 800_500],
    ]);
    expect(mergeSessionReplies(log, turns)).toEqual([]);
    expect(mergeSessionReplies(log, [{ from: { kind: "member", name: "cmo" }, text: " (pass) ", at: T0 + 10 }])).toEqual([]);
    expect(mergeSessionReplies([], turns)).toEqual([]);
  });

  it("does not insert the same session reply twice", () => {
    const c = { from: { kind: "member" as const, name: "cto" }, text: "Once", at: T0 + 1000, rowId: "9" };
    expect(mergeSessionReplies(log, [c, { ...c, at: T0 + 2000, rowId: "10" }])).toHaveLength(1);
  });
});

describe("timeline", () => {
  const now = T0 + 3600_000;
  it("labels days", () => {
    expect(dayLabel(now - 60_000, now)).toBe("Today");
    expect(dayLabel(now - 86_400_000, now)).toBe("Yesterday");
    expect(dayLabel(now - 30 * 86_400_000, now)).not.toMatch(/Today|Yesterday/);
  });
  it("groups senders, marks threads and resolves truncation status", () => {
    const entries: MirrorEntry[] = [
      { id: "y", from: { kind: "user", name: "You" }, text: "old", at: T0 - 86_400_000, thread: "t0" },
      { id: "a", from: { kind: "member", name: "ceo" }, text: "one", at: T0, thread: "t1" },
      { id: "b", from: { kind: "member", name: "ceo" }, text: "two", at: T0 + 1000, thread: "t1" },
      { id: "c", from: { kind: "member", name: "cfo" }, text: `cut${MARK}`, at: T0 + 2000, thread: "t1", truncated: true },
      { id: "d", from: { kind: "member", name: "cfo" }, text: `cut2${MARK}`, at: T0 + 3000, thread: "t2", truncated: true },
    ];
    const rows = buildRoomTimeline(entries, { now, fullTexts: { c: "cut but full" }, resolving: true });
    expect(rows.map((r) => (r.type === "message" ? `${r.key}:${r.first ? "F" : ""}${r.last ? "L" : ""}:${r.status}` : r.type))).toEqual([
      "day",
      "y:FL:full",
      "day",
      "thread",
      "a:F:full",
      "b:L:full",
      "c:FL:full",
      "thread",
      "d:FL:loading",
    ]);
    const c = rows.find((r) => r.type === "message" && r.key === "c");
    expect(c && c.type === "message" && c.text).toBe("cut but full");
    const done = buildRoomTimeline(entries, { now, fullTexts: { d: null } });
    const d = done[done.length - 1];
    expect(d.type === "message" && [d.status, d.text]).toEqual(["missing", "cut2…(truncated)"]);
  });
});
