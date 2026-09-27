import {
  buildTimeline,
  clientEventId,
  deriveActivity,
  memberInput,
  mentionedHandles,
  mergeEvents,
  resolveMentions,
  roomMembers,
  roomPreview,
  toggleMention,
} from "@/features/groups/groupEvents";
import type { GroupEvent } from "@/features/groups/types";

const room = {
  members: [
    { member_id: "coder", profile: "coder", handle: "coder", display_name: "Coder" },
    { member_id: "researcher", profile: "researcher", handle: "researcher", display_name: "Researcher" },
    { member_id: "writer", profile: "writer", handle: "writer", display_name: "" },
  ],
};
const members = roomMembers(room);
const GW = { kind: "gateway", id: "install:x" };

let seq = 0;
function ev(kind: string, payload: Record<string, unknown>, actor: GroupEvent["actor"] = GW, eventId?: string): GroupEvent {
  seq += 1;
  return { room_id: "r1", seq, event_id: eventId ?? `ev${seq}`, kind, actor, payload, created_at: 1_700_000_000 + seq };
}
const user = (text: string, id: string) => ev("message.user", { text, thread_id: "r1" }, { kind: "user", id: "desktop" }, id);
const coords = (disc: string, member: string, round = 0) => ({
  discussion_event_id: disc,
  member_id: member,
  member_index: 0,
  round_index: round,
  task_id: `dtask:${member}${round}`,
  thread_id: "r1",
  turn_id: "t",
});
const reply = (disc: string, member: string, text: string, round = 0) =>
  ev("message.member", { ...coords(disc, member, round), text }, { kind: "member", id: member, profile: member });
const settled = (disc: string, member: string, round = 0, passed = false) =>
  ev("turn.settled", { ...coords(disc, member, round), seen_through_seq: 1, message_event_id: passed ? null : "m", passed });

beforeEach(() => {
  seq = 0;
});

describe("members", () => {
  it("normalises roster rows and falls back to a title-cased profile name", () => {
    expect(members.map((m) => m.name)).toEqual(["Coder", "Researcher", "Writer"]);
  });

  it("builds the exact groups.create member shape", () => {
    expect(memberInput("growth-bot", "")).toEqual({
      member_id: "growth-bot",
      profile: "growth-bot",
      handle: "growth-bot",
      display_name: "Growth Bot",
      target: { kind: "local", profile: "growth-bot" },
    });
  });
});

describe("mergeEvents", () => {
  it("appends newer pages and dedupes overlapping seqs in order", () => {
    const a = [ev("room.created", {}), user("hi", "u1")];
    const b = [ev("room.renamed", { name: "X" })];
    const merged = mergeEvents(a, b);
    expect(merged.map((e) => e.seq)).toEqual([1, 2, 3]);
    const again = mergeEvents(merged, [merged[1], b[0], { ...b[0], seq: 0 }]);
    expect(again.map((e) => e.seq)).toEqual([0, 1, 2, 3]);
    expect(mergeEvents(merged, [])).toBe(merged);
  });
});

describe("buildTimeline", () => {
  it("maps messages and notices and hides bookkeeping", () => {
    const events = [
      ev("room.created", {}, { kind: "system", id: "room-control" }),
      user("hello @coder", "u1"),
      reply("u1", "coder", "Hi **there**"),
      settled("u1", "coder"),
      reply("u1", "coder", "Second thought"),
      ev("turn.failed", { ...coords("u1", "researcher"), error: "rate limited" }),
      ev("turn.cancelled", { ...coords("u1", "writer"), reason: "superseded_by_newer_user_event" }),
      ev("room.activity", { status: "settled", reason_code: "silent_round", thread_id: "r1", discussion_event_id: "u1" }),
      ev("authority.claimed", {}),
      ev("room.renamed", { name: "Launch" }),
    ];
    const items = buildTimeline(events, members);
    expect(items.map((i) => i.type)).toEqual(["notice", "user", "member", "member", "notice", "notice"]);
    const [, u, first, second, failed, renamed] = items;
    expect(u).toMatchObject({ type: "user", text: "hello @coder" });
    expect(first).toMatchObject({ type: "member", showHeader: true, text: "Hi **there**" });
    expect(second).toMatchObject({ type: "member", showHeader: false });
    expect(failed).toMatchObject({ tone: "error", text: "Researcher couldn't reply: rate limited" });
    expect(renamed).toMatchObject({ text: "Renamed to “Launch”" });
  });

  it("resolves unknown actors from the event itself", () => {
    const items = buildTimeline(
      [ev("message.member", { ...coords("u1", "ghost"), text: "boo" }, { kind: "member", id: "ghost", profile: "ghost", display_name: "Ghost Bot" })],
      members,
    );
    expect(items[0]).toMatchObject({ member: { id: "ghost", name: "Ghost Bot" } });
  });
});

describe("mentions", () => {
  it("follows the server's resolve_mentions rules", () => {
    expect(resolveMentions("no mentions", members)).toHaveLength(3);
    expect(resolveMentions("hey @Writer and @nobody", members).map((m) => m.id)).toEqual(["writer"]);
    expect(resolveMentions("@coder @all", members)).toHaveLength(3);
    expect(resolveMentions("plain", members, false)).toHaveLength(0);
    expect(mentionedHandles("@coder, @researcher!", members).handles).toEqual(new Set(["coder", "researcher"]));
    // Same as the server regex: "." is a handle character, so a trailing period does not resolve.
    expect(mentionedHandles("ask @researcher.", members).handles.size).toBe(0);
  });

  it("toggles a mention chip in the draft", () => {
    expect(toggleMention("fix it", "coder")).toBe("@coder fix it");
    expect(toggleMention("@coder fix it", "coder")).toBe("fix it");
    expect(toggleMention("ask @coder please", "coder")).toBe("ask please");
    expect(toggleMention("@coderx hi", "coder")).toBe("@coder @coderx hi");
  });
});

describe("deriveActivity", () => {
  it("is idle with no user message", () => {
    expect(deriveActivity([ev("room.created", {})], members)).toEqual({ pending: false, working: null, discussionEventId: null });
  });

  it("predicts the next bot in roster order and advances as turns settle", () => {
    const events = [user("thoughts?", "u1")];
    expect(deriveActivity(events, members).working?.id).toBe("coder");
    events.push(reply("u1", "coder", "mine"), settled("u1", "coder"));
    expect(deriveActivity(events, members).working?.id).toBe("researcher");
    events.push(settled("u1", "researcher", 0, true), settled("u1", "writer", 0, true));
    expect(deriveActivity(events, members)).toMatchObject({ pending: true, working: null });
    events.push(ev("room.activity", { status: "settled", reason_code: "silent_round", thread_id: "r1", discussion_event_id: "u1" }));
    expect(deriveActivity(events, members).pending).toBe(false);
  });

  it("only waits on mentioned bots, then on peers a bot cites in round 1", () => {
    const events = [user("@researcher go", "u1")];
    expect(deriveActivity(events, members).working?.id).toBe("researcher");
    events.push(reply("u1", "researcher", "@writer can you polish?"), settled("u1", "researcher"));
    expect(deriveActivity(events, members).working?.id).toBe("writer");
  });

  it("clears after a stop request", () => {
    const events = [user("go", "u1"), ev("room.stop_requested", { cancel_id: "c" })];
    expect(deriveActivity(events, members).pending).toBe(false);
  });
});

describe("roomPreview", () => {
  it("returns the latest visible line with its author", () => {
    const events = [user("hi", "u1"), reply("u1", "coder", "Hello\n\nworld"), settled("u1", "coder")];
    expect(roomPreview(events, members)).toMatchObject({ text: "Hello world", author: "Coder" });
    expect(roomPreview([], members)).toBeNull();
  });
});

it("client event ids satisfy the server identifier rule", () => {
  expect(clientEventId("mobile", 1_700_000_000_000, 0.5)).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
});
