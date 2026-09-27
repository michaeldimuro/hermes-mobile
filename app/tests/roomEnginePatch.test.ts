import { applyMobileWrite } from "@/features/rooms/engine/mirrorCodec";

describe("mirror patch (rename / members)", () => {
  it("renames and replaces members in place, bumping only that room's revision", () => {
    const remote = {
      version: 3,
      updatedAt: 1,
      rooms: {
        "id:a": { name: "Old", roomId: "a", log: [], revision: 3, members: [{ name: "cto" }] },
        "id:b": { name: "Other", roomId: "b", log: [], revision: 2 },
      },
    };
    const { envelope } = applyMobileWrite(remote, 7, { roomKey: "id:a", patch: { name: "New", members: [{ name: "cto" }, { name: "cfo" }] } }, 100);
    expect(envelope.rooms["id:a"]).toMatchObject({ name: "New", revision: 8, members: [{ name: "cto" }, { name: "cfo" }] });
    expect(envelope.rooms["id:b"].revision).toBe(2);
  });
});
