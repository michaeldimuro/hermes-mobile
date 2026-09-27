import {
  applyMobileWrite,
  compactSyncText,
  findRoomKey,
  groupChatGatewayJsonSize,
  mintEntryId,
  mintRoomId,
  mintThreadId,
  normalizeEnvelope,
  serializeEnvelope,
  trimEnvelope,
  uniqueGroupChatName,
  type RawEnvelope,
} from "@/features/rooms/engine/mirrorCodec";

const NOW = 1_790_000_000_000;
const member = { name: "cfo", handle: "cfo", connectionId: "local", connectionKind: "local", connectionLabel: "This device", sourceScoped: true as const };

function envelope(): RawEnvelope {
  return {
    version: 3,
    updatedAt: 5,
    deleted: { "id:old": 3 },
    rooms: {
      "id:r1": {
        name: "C Suite",
        roomId: "r1",
        holdDetection: true,
        revision: 7,
        omitted: 2,
        image: "data:image/png;base64,AAAA",
        members: [member],
        log: [
          { id: "a", from: { kind: "user", name: "You" }, text: "hi", at: NOW + 50_000, thread: "t1" },
          { id: "b", from: { kind: "member", name: "cfo", source: "This device" }, text: "hello", at: NOW + 60_000, thread: "t1" },
        ],
      },
      "id:r2": { name: "Other", roomId: "r2", holdDetection: false, revision: 4, members: [], log: [{ id: "c", from: { kind: "user", name: "You" }, text: "x", at: 10, thread: "t9" }] },
    },
  };
}

describe("normalizeEnvelope", () => {
  it("keeps v3 as is and tolerates garbage", () => {
    expect(normalizeEnvelope(envelope())).toEqual(envelope());
    expect(normalizeEnvelope(null)).toEqual({ version: 3, updatedAt: 0, rooms: {}, deleted: {} });
  });
  it("lifts v1/v2 name-keyed rooms; v1 tombstones never outrank revisions", () => {
    const v1 = normalizeEnvelope({ version: 1, rooms: { Team: { log: [] }, Broken: { log: "nope" } }, deleted: { Gone: 1234 } });
    expect(Object.keys(v1.rooms)).toEqual(["name:Team"]);
    expect(v1.rooms["name:Team"].name).toBe("Team");
    expect(v1.deleted).toEqual({ "name:Gone": 0 });
    expect(normalizeEnvelope({ version: 2, rooms: {}, deleted: { Gone: 9 } }).deleted).toEqual({ "name:Gone": 9 });
  });
  it("does not alias the input", () => {
    const input = envelope();
    normalizeEnvelope(input).rooms["id:r1"].name = "changed";
    expect(input.rooms["id:r1"].name).toBe("C Suite");
  });
});

describe("groupChatGatewayJsonSize", () => {
  it("counts ASCII 1 (+1 per , or :), BMP 6, astral 12", () => {
    expect(groupChatGatewayJsonSize("a")).toBe(3);
    expect(groupChatGatewayJsonSize({ a: 1 })).toBe(8);
    expect(groupChatGatewayJsonSize(["a,b"])).toBe(8);
    expect(groupChatGatewayJsonSize("é")).toBe(8);
    expect(groupChatGatewayJsonSize("😀")).toBe(14);
  });
});

describe("text and ids", () => {
  it("marks truncated sync text instead of silently slicing it (desktop test)", () => {
    const long = `plan:${"x".repeat(2000)}`;
    const compacted = compactSyncText(long);
    expect(compacted.truncated).toBe(true);
    expect(compacted.text).toContain("[truncated]");
    expect(compacted.text.length).toBeLessThanOrEqual(1200);
    expect(compacted.text.endsWith("… [truncated]")).toBe(true);
    expect(compacted.text.startsWith("plan:")).toBe(true);
    expect(compactSyncText("short").truncated).toBeUndefined();
  });
  it("same-name dedup reserves suffix length at the 64-char cap (desktop test)", () => {
    expect(uniqueGroupChatName("Team", new Set(["Other"]))).toBe("Team");
    expect(uniqueGroupChatName("Team", new Set(["Team", "Team 2"]))).toBe("Team 3");
    const base = "x".repeat(64);
    const next = uniqueGroupChatName(base, new Set([base, `${base.slice(0, 62)} 2`]));
    expect(next).toHaveLength(64);
    expect(next).toBe(`${base.slice(0, 62)} 3`);
  });
  it("mints ids in the desktop formats", () => {
    expect(mintRoomId(NOW)).toMatch(new RegExp(`^r${NOW.toString(36)}-[0-9a-z]{1,5}$`));
    expect(mintThreadId(NOW)).toMatch(new RegExp(`^t${NOW.toString(36)}-[0-9a-z]{1,5}$`));
    expect(mintEntryId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
  it("finds rooms by id key, stored roomId or legacy name", () => {
    const env = envelope();
    env.rooms["name:Legacy"] = { name: "Legacy", log: [] };
    expect(findRoomKey(env, "r1")).toBe("id:r1");
    expect(findRoomKey(env, "Legacy")).toBe("name:Legacy");
    expect(findRoomKey(env, "missing")).toBeNull();
  });
});

describe("applyMobileWrite", () => {
  const user = { kind: "user" as const, name: "You" };

  it("appends with strictly increasing at, thread set, and stamps only the touched room", () => {
    const { envelope: next, written } = applyMobileWrite(
      envelope(),
      64,
      { roomKey: "id:r1", entries: [{ id: "n1", from: user, text: "one", thread: "t2" }, { id: "n2", from: user, text: "two", thread: "t2" }] },
      NOW,
    );
    const room = next.rooms["id:r1"];
    expect(written.map((e) => e.at)).toEqual([NOW + 60_001, NOW + 60_002]);
    expect(room.log.slice(-2).map((e) => [e.id, e.thread, e.text])).toEqual([["n1", "t2", "one"], ["n2", "t2", "two"]]);
    expect(room.revision).toBe(65);
    expect(next.rooms["id:r2"]).toEqual(envelope().rooms["id:r2"]);
    const { log: _log, revision: _rev, ...identity } = room;
    const { log: _l0, revision: _r0, ...identity0 } = envelope().rooms["id:r1"];
    expect(identity).toEqual(identity0);
    expect(next.deleted).toEqual({ "id:old": 3 });
    expect(next.updatedAt).toBe(NOW);
    expect(next.version).toBe(3);
  });

  it("uses now when it is later than the log, compacts long text and is idempotent by id", () => {
    const later = NOW + 1_000_000;
    const long = "y".repeat(3000);
    const first = applyMobileWrite(envelope(), 1, { roomKey: "id:r1", entries: [{ id: "n1", from: user, text: long, thread: "t1" }] }, later);
    expect(first.written[0]).toMatchObject({ at: later, truncated: true });
    expect(first.written[0].text).toHaveLength(1200);
    const again = applyMobileWrite(first.envelope, 2, { roomKey: "id:r1", entries: [{ id: "n1", from: user, text: long, thread: "t1" }] }, later + 5);
    expect(again.envelope.rooms["id:r1"].log.filter((e) => e.id === "n1")).toHaveLength(1);
    expect(again.written[0].at).toBe(later);
  });

  it("adds a room and disbands one with a final id tombstone", () => {
    const added = applyMobileWrite(envelope(), 10, { roomKey: "id:r3", addRoom: { name: "New", roomId: "r3", holdDetection: true, members: [member], log: [] } }, NOW);
    expect(added.envelope.rooms["id:r3"]).toMatchObject({ name: "New", revision: 11, log: [] });
    const gone = applyMobileWrite(added.envelope, 11, { roomKey: "id:r3", disband: true }, NOW);
    expect(gone.envelope.rooms["id:r3"]).toBeUndefined();
    expect(gone.envelope.deleted["id:r3"]).toBe(12);
    expect(() => applyMobileWrite(gone.envelope, 12, { roomKey: "id:r3", entries: [] })).toThrow(/deleted/);
    expect(() => applyMobileWrite(envelope(), 1, { roomKey: "id:nope", entries: [] })).toThrow(/no longer exists/);
  });

  it("keeps at most 64 tombstones, highest revision first", () => {
    const env = envelope();
    for (let i = 0; i < 70; i++) env.deleted[`id:x${i}`] = i;
    const next = applyMobileWrite(env, 100, { roomKey: "id:r1", entries: [] }, NOW).envelope;
    expect(Object.keys(next.deleted)).toHaveLength(64);
    expect(next.deleted["id:x69"]).toBe(69);
    expect(next.deleted["id:x0"]).toBeUndefined();
  });

  it("trims the least recently active room's oldest entries first, counting omitted", () => {
    const env = envelope();
    env.rooms["id:r2"].log = Array.from({ length: 50 }, (_, i) => ({ id: `o${i}`, from: user, text: "z".repeat(1000), at: 100 + i, thread: "t9" }));
    const next = applyMobileWrite(env, 1, { roomKey: "id:r1", entries: [{ id: "n", from: user, text: "new", thread: "t1" }] }, NOW).envelope;
    expect(groupChatGatewayJsonSize(serializeEnvelope(next))).toBeLessThanOrEqual(48_000);
    const r2 = next.rooms["id:r2"];
    expect(r2.log.length).toBeLessThan(50);
    expect(r2.omitted).toBe(50 - r2.log.length);
    expect(r2.log[r2.log.length - 1].id).toBe("o49");
    expect(next.rooms["id:r1"].log).toHaveLength(3);
    expect(next.rooms["id:r1"].omitted).toBe(2);
  });

  it("refuses rather than dropping whole rooms when entries alone cannot fit", () => {
    const env = envelope();
    env.rooms["id:r2"].log = [{ id: "big", from: user, text: "é".repeat(9000), at: 1, thread: "t" }];
    expect(() => trimEnvelope(env)).toThrow(/full/);
  });

  it("serializes without an empty deleted map", () => {
    const env = envelope();
    env.deleted = {};
    expect("deleted" in serializeEnvelope(env)).toBe(false);
    expect(serializeEnvelope(envelope()).deleted).toEqual({ "id:old": 3 });
  });
});
