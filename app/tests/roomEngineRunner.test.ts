import { readMirror, updateBotGroups, writeMirror } from "@/features/rooms/engine/mirrorWrite";
import { createDesktopRoom, disbandDesktopRoom, planNewRoom, takenRoomNames } from "@/features/rooms/engine/roomCreate";
import { createGroupRunner, engineMembers, mobileWatermarks, type GatewayEventLike } from "@/features/rooms/engine/roundRunner";
import type { RawEnvelope } from "@/features/rooms/engine/mirrorCodec";
import type { EngineMember } from "@/features/rooms/engine/roundPrompt";

type Msg = { role: string; text: string; timestamp: number };
type Session = { title: string; profile: string; messages: Msg[]; running?: boolean; open_requests?: { id: string; method: string }[] };

const LOCAL = { connectionId: "local", connectionKind: "local", connectionLabel: "This device", sourceScoped: true as const };
const ROSTER: EngineMember[] = [
  { name: "cfo", handle: "cfo", title: "CFO" },
  { name: "cto", handle: "cto", title: "Chief Technology Officer" },
  { name: "ceo", handle: "ceo", title: "CEO" },
];

/** In-memory gateway: profiles with CAS'd ui_meta, member sessions and scripted replies. */
function mockGateway(opts: { reply?: (profile: string, prompt: string) => string; conflictsFirst?: number } = {}) {
  const meta: Record<string, { ui_meta: Record<string, unknown>; revs: Record<string, number> }> = {
    default: { ui_meta: {}, revs: {} },
    cfo: { ui_meta: { "hermes-bots": { title: "CFO", groups: ["C Suite"], group: "C Suite" } }, revs: { "hermes-bots": 3 } },
    cto: { ui_meta: { "hermes-bots": { title: "Chief Technology Officer" } }, revs: {} },
    ceo: { ui_meta: {}, revs: {} },
  };
  const sessions = new Map<string, Session>();
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  let conflicts = opts.conflictsFirst ?? 0;
  let n = 0;
  const listeners = new Set<(e: GatewayEventLike) => void>();
  const err = (code: number, message: string) => Object.assign(new Error(message), { code });
  const byTitle = (title: string, profile: string) => [...sessions.entries()].find(([, s]) => s.title === title && s.profile === profile);

  const call = async <T,>(method: string, params: Record<string, unknown> = {}): Promise<T> => {
    calls.push({ method, params });
    const p = params as Record<string, any>;
    switch (method) {
      case "profiles.list":
        return { profiles: Object.entries(meta).map(([name, m]) => ({ name, ui_meta: m.ui_meta, ui_meta_revisions: { ...m.revs } })) } as T;
      case "profiles.configure": {
        const m = meta[p.name];
        const key = Object.keys(p.ui_meta)[0];
        if (conflicts > 0 || (p.ui_meta_expected_revisions?.[key] ?? 0) !== (m.revs[key] ?? 0)) {
          conflicts -= 1;
          return { applied: { ui_meta: false, ui_meta_conflicts: { [key]: {} }, ui_meta_revisions: { [key]: m.revs[key] ?? 0 } } } as T;
        }
        m.ui_meta[key] = JSON.parse(JSON.stringify(p.ui_meta[key]));
        m.revs[key] = (m.revs[key] ?? 0) + 1;
        return { applied: { ui_meta: true, ui_meta_revisions: { [key]: m.revs[key] } } } as T;
      }
      case "session.resume": {
        const found = sessions.get(p.session_id) ? [p.session_id, sessions.get(p.session_id)!] : byTitle(p.session_id, p.profile);
        if (!found) throw err(4007, "session not found");
        const [id, s] = found as [string, Session];
        return { session_id: `rt-${id}`, session_key: id, running: Boolean(s.running), open_requests: s.open_requests, messages: p.omit_messages ? undefined : s.messages } as T;
      }
      case "session.create": {
        const id = `s${++n}`;
        sessions.set(id, { title: p.title, profile: p.profile, messages: [] });
        return { session_id: `rt-${id}`, stored_session_id: id } as T;
      }
      case "prompt.submit": {
        const id = String(p.session_id).replace(/^rt-/, "");
        const s = sessions.get(id)!;
        s.messages.push({ role: "user", text: p.text, timestamp: Date.now() / 1000 });
        s.messages.push({ role: "assistant", text: opts.reply ? opts.reply(s.profile, p.text) : "(pass)", timestamp: Date.now() / 1000 });
        listeners.forEach((l) => l({ type: "message.complete", session_id: p.session_id }));
        return {} as T;
      }
      case "session.interrupt":
        return {} as T;
      default:
        throw new Error(`unexpected ${method}`);
    }
  };
  const envelope = () => meta.default.ui_meta["hermes-bots-groups"] as RawEnvelope;
  return { call, calls, sessions, meta, envelope, port: { call, onEvent: (l: (e: GatewayEventLike) => void) => (listeners.add(l), () => void listeners.delete(l)), wait: () => Promise.resolve() } };
}

const handleFor = (name: string) => name;
const instant = { wait: () => Promise.resolve() };

async function seedRoom(gw: ReturnType<typeof mockGateway>, members = ["cfo", "cto"]) {
  const created = await createDesktopRoom(gw.call, { name: "Mobile test", members }, handleFor);
  return created.roomId;
}

beforeEach(() => mobileWatermarks.clear());

describe("CAS writer", () => {
  it("re-reads and retries on conflict, then verifies the read-back", async () => {
    const gw = mockGateway({ conflictsFirst: 2 });
    const roomId = await seedRoom(gw);
    const writes = gw.calls.filter((c) => c.method === "profiles.configure" && c.params.name === "default");
    expect(writes).toHaveLength(3);
    expect(writes.map((c) => (c.params.ui_meta_expected_revisions as Record<string, number>)["hermes-bots-groups"])).toEqual([0, 0, 0]);
    const read = await readMirror(gw.call);
    expect(read.revision).toBe(1);
    expect(read.envelope.rooms[`id:${roomId}`].revision).toBe(1);
  });
  it("gives up after 6 attempts", async () => {
    const gw = mockGateway({ conflictsFirst: 99 });
    await expect(writeMirror(gw.call, { roomKey: "id:x", addRoom: { name: "X", roomId: "x", log: [] } }, instant)).rejects.toThrow(/rejected/);
    expect(gw.calls.filter((c) => c.method === "profiles.configure")).toHaveLength(6);
  });
  it("updates a bot's group list with CAS and can revert it", async () => {
    const gw = mockGateway();
    expect(await updateBotGroups(gw.call, "cfo", { add: "Ops" }, instant)).toBe(true);
    expect(gw.meta.cfo.ui_meta["hermes-bots"]).toEqual({ title: "CFO", groups: ["C Suite", "Ops"], group: "C Suite" });
    expect(gw.meta.cfo.revs["hermes-bots"]).toBe(4);
    expect(await updateBotGroups(gw.call, "cfo", { add: "Ops" }, instant)).toBe(false);
    await updateBotGroups(gw.call, "cto", { add: "Ops" }, instant);
    expect(gw.meta.cto.ui_meta["hermes-bots"]).toEqual({ title: "Chief Technology Officer", groups: ["Ops"], group: "Ops" });
    await updateBotGroups(gw.call, "cto", { remove: "Ops" }, instant);
    expect(gw.meta.cto.ui_meta["hermes-bots"]).toEqual({ title: "Chief Technology Officer", groups: [] });
  });
});

describe("room creation", () => {
  it("writes the desktop room shape with unique names and local descriptors", async () => {
    const gw = mockGateway();
    const roomId = await seedRoom(gw);
    const room = gw.envelope().rooms[`id:${roomId}`];
    expect(roomId).toMatch(/^r[0-9a-z]+-[0-9a-z]{1,5}$/);
    expect(room).toEqual({ name: "Mobile test", roomId, log: [], holdDetection: true, revision: 1, members: [{ name: "cfo", handle: "cfo", ...LOCAL }, { name: "cto", handle: "cto", ...LOCAL }] });
    expect((gw.meta.cfo.ui_meta["hermes-bots"] as { groups: string[] }).groups).toEqual(["C Suite", "Mobile test"]);
    const second = await createDesktopRoom(gw.call, { name: "Mobile test", members: ["ceo"] }, handleFor);
    expect(gw.envelope().rooms[`id:${second.roomId}`].name).toBe("Mobile test 2");
  });
  it("treats bot group lists and name tombstones as taken, copies existing descriptors, validates input", () => {
    const env: RawEnvelope = {
      version: 3,
      updatedAt: 0,
      deleted: { "name:Old": 1, "id:z": 2 },
      rooms: { "id:a": { name: "A", roomId: "a", log: [], members: [{ name: "cfo", handle: "money", connectionId: "local", connectionLabel: "Studio", sourceScoped: true }] } },
    };
    const profiles = [{ name: "cfo", ui_meta: { "hermes-bots": { groups: ["Ops"], group: "Ops" } } }, { name: "cto" }];
    expect([...takenRoomNames(env, profiles)].sort()).toEqual(["A", "Old", "Ops"]);
    const plan = planNewRoom({ envelope: env, profiles }, { name: "  Ops  ", members: ["cfo", "cto", "cfo"] }, "r1", handleFor);
    expect(plan.name).toBe("Ops 2");
    expect(plan.room.members?.[0]).toEqual({ name: "cfo", handle: "money", connectionId: "local", connectionLabel: "Studio", sourceScoped: true });
    expect(plan.room.members).toHaveLength(2);
    expect(() => planNewRoom({ envelope: env, profiles }, { name: " ", members: ["cfo"] }, "r2", handleFor)).toThrow(/name/);
    expect(() => planNewRoom({ envelope: env, profiles }, { name: "X", members: [] }, "r2", handleFor)).toThrow(/at least one/);
    expect(() => planNewRoom({ envelope: env, profiles }, { name: "X", members: ["nope"] }, "r2", handleFor)).toThrow(/No Hermes profile/);
    expect(() => planNewRoom({ envelope: env, profiles }, { name: "X", members: ["a", "b", "c", "d", "e", "f", "g"] }, "r2", handleFor)).toThrow(/at most 6/);
  });
  it("disbands with a final id tombstone and reverts the bot group lists", async () => {
    const gw = mockGateway();
    const roomId = await seedRoom(gw);
    await disbandDesktopRoom(gw.call, roomId);
    expect(gw.envelope().rooms[`id:${roomId}`]).toBeUndefined();
    expect(gw.envelope().deleted[`id:${roomId}`]).toBe(2);
    expect((gw.meta.cfo.ui_meta["hermes-bots"] as { groups: string[] }).groups).toEqual(["C Suite"]);
  });
});

describe("round runner", () => {
  it("posts the user entry, prompts only the mentioned member with the desktop prompt, and appends its reply", async () => {
    const gw = mockGateway({ reply: (profile, prompt) => (profile === "cfo" && prompt.includes("(user)") ? "OK" : "(pass)") });
    const roomId = await seedRoom(gw);
    const progress: unknown[] = [];
    const runner = createGroupRunner(gw.port, { onProgress: (p) => progress.push(p) });
    const result = await runner.drive({ roomId, thread: null, text: " @cfo reply with exactly: OK ", roster: ROSTER });
    const log = gw.envelope().rooms[`id:${roomId}`].log;
    expect(log.map((e) => [e.from, e.text, e.thread])).toEqual([
      [{ kind: "user", name: "You" }, "@cfo reply with exactly: OK", result.thread],
      [{ kind: "member", name: "cfo", source: "This device" }, "OK", result.thread],
    ]);
    expect(log[1].at).toBeGreaterThan(log[0].at);
    expect(result).toMatchObject({ posted: 1, exit: "settled" });
    expect(result.thread).toMatch(/^t[0-9a-z]+-/);
    const created = gw.calls.filter((c) => c.method === "session.create").map((c) => c.params);
    expect(created).toEqual([{ profile: "cfo", title: `Group: ${roomId} · ${result.thread}`, hidden: true, room_plumbing: true, follow_profile_config: true }]);
    const prompt = String(gw.calls.find((c) => c.method === "prompt.submit")?.params.text);
    expect(prompt.startsWith('[Group chat: "Mobile test"] You are @cfo, one participant in a group chat with Chief Technology Officer (@chief-technology-officer) and the user.\n\nNew messages in the room since your last turn (oldest first):\n  You (user): @cfo reply with exactly: OK\n\nRules for this room:\n')).toBe(true);
    // Like the desktop, the member then sees its own reply as a (you) line once, and passes. CTO is never prompted.
    const submits = gw.calls.filter((c) => c.method === "prompt.submit").map((c) => String(c.params.text));
    expect(submits).toHaveLength(2);
    expect(submits.every((t) => t.includes("You are @cfo,"))).toBe(true);
    expect(submits[1]).toContain("  CFO (you) [This device]: OK");
    expect(progress).toContainEqual({ member: "cfo", round: 1 });
    expect(progress[progress.length - 1]).toBeNull();
  });

  it("pulls a member cited by a bot into the next round and shows the bot its own reply as (you)", async () => {
    const gw = mockGateway({
      reply: (profile, prompt) => (!prompt.includes("(user)") ? "(pass)" : profile === "cfo" ? "@cto can you confirm?" : profile === "cto" ? "Confirmed." : "(pass)"),
    });
    const roomId = await seedRoom(gw);
    const result = await createGroupRunner(gw.port).drive({ roomId, thread: null, text: "@cfo numbers?", roster: ROSTER });
    const texts = gw.envelope().rooms[`id:${roomId}`].log.map((e) => `${e.from.name}: ${e.text}`);
    expect(texts).toEqual(["You: @cfo numbers?", "cfo: @cto can you confirm?", "cto: Confirmed."]);
    const cfoPrompts = gw.calls.filter((c) => c.method === "prompt.submit" && String(c.params.text).includes("You are @cfo")).map((c) => String(c.params.text));
    expect(cfoPrompts).toHaveLength(2);
    expect(cfoPrompts[1]).toContain("  CFO (you) [This device]: @cto can you confirm?");
    expect(cfoPrompts[1]).toContain("  Chief Technology Officer [This device]: Confirmed.");
    expect(cfoPrompts[1]).not.toContain("You (user)");
    expect(result.posted).toBe(2);
  });

  it("continues the latest thread with only the new delta via the mobile watermark", async () => {
    const gw = mockGateway({ reply: (profile, prompt) => (profile === "cfo" && prompt.includes("(user)") ? "Sure." : "(pass)") });
    const roomId = await seedRoom(gw, ["cfo"]);
    const first = await createGroupRunner(gw.port).drive({ roomId, thread: null, text: "hello", roster: ROSTER });
    await createGroupRunner(gw.port).drive({ roomId, thread: first.thread, text: "and again", roster: ROSTER });
    const prompts = gw.calls.filter((c) => c.method === "prompt.submit").map((c) => String(c.params.text));
    // hello → "Sure.", then its own reply comes back as (you) and it passes; the next send carries only the new line.
    expect(prompts).toHaveLength(4);
    expect(prompts[1]).toContain("  CFO (you) [This device]: Sure.");
    expect(prompts[1]).not.toContain("(user)");
    expect(prompts[2]).toContain("  You (user): and again");
    expect(prompts[2]).not.toContain("hello");
    expect(prompts[2]).not.toContain("Sure.");
    expect(gw.calls.filter((c) => c.method === "session.create")).toHaveLength(1);
  });

  it("falls back to the member's last room prompt time when there is no watermark", async () => {
    const gw = mockGateway({ reply: () => "(pass)" });
    const roomId = await seedRoom(gw, ["cfo"]);
    const first = await createGroupRunner(gw.port).drive({ roomId, thread: null, text: "one", roster: ROSTER });
    mobileWatermarks.clear();
    await new Promise((r) => setTimeout(r, 5));
    await createGroupRunner(gw.port).drive({ roomId, thread: first.thread, text: "two", roster: ROSTER });
    const last = String(gw.calls.filter((c) => c.method === "prompt.submit").pop()?.params.text);
    expect(last).toContain("You (user): two");
    expect(last).not.toContain("You (user): one");
  });

  it("skips a member whose session is busy on the desktop, and never submits into it", async () => {
    const gw = mockGateway({ reply: () => "hi" });
    const roomId = await seedRoom(gw, ["cfo", "cto"]);
    const thread = "tbusy-1";
    gw.sessions.set("busy", { title: `Group: ${roomId} · ${thread}`, profile: "cto", messages: [], running: true });
    const notices: string[] = [];
    await createGroupRunner(gw.port, { onNotice: (t) => notices.push(t) }).drive({ roomId, thread, text: "@everyone status", roster: ROSTER });
    expect(notices).toContain("Chief Technology Officer is busy on Hermes desktop, skipped this round");
    expect(gw.calls.some((c) => c.method === "prompt.submit" && c.params.session_id === "rt-busy")).toBe(false);
    expect(gw.envelope().rooms[`id:${roomId}`].log.map((e) => e.from.name)).toEqual(["You", "cfo"]);
  });

  it("stops after the current turn and interrupts the active member", async () => {
    let runner: ReturnType<typeof createGroupRunner> | null = null;
    const gw = mockGateway({
      reply: () => {
        runner?.stop();
        return "first";
      },
    });
    const roomId = await seedRoom(gw, ["cfo", "cto"]);
    runner = createGroupRunner(gw.port);
    const result = await runner.drive({ roomId, thread: null, text: "@everyone go", roster: ROSTER });
    expect(result.exit).toBe("stopped");
    expect(gw.calls.filter((c) => c.method === "prompt.submit")).toHaveLength(1);
    expect(gw.calls.some((c) => c.method === "session.interrupt")).toBe(true);
    expect(gw.envelope().rooms[`id:${roomId}`].log).toHaveLength(2);
  });

  it("maps mirror descriptors to engine members with profile titles", () => {
    expect(engineMembers([{ name: "cto", handle: "cto", ...LOCAL }], ROSTER)).toEqual([
      { name: "cto", handle: "cto", title: "Chief Technology Officer", ...LOCAL },
    ]);
  });

  it("refuses to post into a room that no longer exists", async () => {
    const gw = mockGateway();
    await expect(createGroupRunner(gw.port).drive({ roomId: "rgone", thread: null, text: "hi", roster: ROSTER })).rejects.toThrow(/no longer exists/);
  });
});
