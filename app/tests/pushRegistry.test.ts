import { nextPushMeta } from "@/features/push/pushRegistry";

describe("push registry", () => {
  it("adds, refreshes and removes devices by token", () => {
    const one = nextPushMeta(null, "a", { token: "a", name: "iPhone", at: 1 });
    const two = nextPushMeta(one, "b", { token: "b", name: "iPad", at: 2 });
    const refreshed = nextPushMeta(two, "a", { token: "a", name: "iPhone", at: 3 });
    expect(refreshed.devices.map((d) => `${d.token}:${d.at}`)).toEqual(["b:2", "a:3"]);
    expect(nextPushMeta(refreshed, "b", null).devices.map((d) => d.token)).toEqual(["a"]);
    expect(nextPushMeta({ devices: "junk" }, "x", null).devices).toEqual([]);
  });
});
