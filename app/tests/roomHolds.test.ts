import { heldMemberNames, holdText, stopWordPlacement } from "@/features/rooms/engine/roomHolds";

const members = [{ name: "cto", handle: "cto" }, { name: "cfo", handle: "cfo" }];
const user = (text: string) => ({ from: { kind: "user" as const }, text, at: 1 });

describe("room holds (desktop #93129 port)", () => {
  it("places stop words relative to mentions", () => {
    expect(stopWordPlacement("stop @cto")).toBe("adjacent");
    expect(stopWordPlacement("@cto please halt")).toBe("adjacent");
    expect(stopWordPlacement("@cto go on, and later we can stop for lunch")).toBe("distant");
    expect(stopWordPlacement("> stop @cto\n\nthoughts?")).toBeNull();
  });

  it("holds on stop, releases on a direct mention, and @all resumes everyone", () => {
    expect([...heldMemberNames([user("stop @cto")], members, [])]).toEqual(["cto"]);
    expect([...heldMemberNames([user("stop @cto"), user("@cto resume")], members, [])]).toEqual([]);
    expect([...heldMemberNames([user("@all stop")], members, [])].sort()).toEqual(["cfo", "cto"]);
    expect([...heldMemberNames([user("@all stop"), user("@all carry on")], members, [])]).toEqual([]);
    expect([...heldMemberNames([user("stop @cto"), { from: { kind: "member" as const, name: "cfo" }, text: "@cto resume", at: 2 }], members, [])]).toEqual(["cto"]);
  });

  it("writes pause/resume in the words the desktop recognises", () => {
    expect(heldMemberNames([user(holdText("cto", true))], members, []).has("cto")).toBe(true);
    expect(heldMemberNames([user(holdText("cto", true)), user(holdText("cto", false))], members, []).has("cto")).toBe(false);
  });
});
