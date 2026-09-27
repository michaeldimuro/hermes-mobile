import { decodePairing } from "@/features/pairing/pairing";

/** What the installer writes: base64url (no padding) of UTF-8 JSON. */
const encode = (value: unknown) =>
  Buffer.from(JSON.stringify(value), "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

describe("decodePairing", () => {
  it("reads the installer's payload", () => {
    const d = encode({ v: 1, url: "https://mac.tail1234.ts.net/", username: "hermes", password: "p@ss+/word" });
    expect(decodePairing(d)).toEqual({ url: "https://mac.tail1234.ts.net", username: "hermes", password: "p@ss+/word" });
  });

  it("keeps non-ASCII characters intact", () => {
    const d = encode({ v: 1, url: "http://192.168.1.20:9119", username: "hermès", password: "🔑ключ" });
    expect(decodePairing(d)?.password).toBe("🔑ключ");
    expect(decodePairing(d)?.username).toBe("hermès");
  });

  it("accepts the first value when the router hands over an array", () => {
    const d = encode({ v: 1, url: "https://h.example", username: "a", password: "b" });
    expect(decodePairing([d, "junk"])?.url).toBe("https://h.example");
  });

  it.each([
    ["missing", undefined],
    ["not base64", "%%%"],
    ["not JSON", encode("hello").slice(0, 3)],
    ["wrong version", encode({ v: 2, url: "https://h", username: "a", password: "b" })],
    ["not a web address", encode({ v: 1, url: "javascript:alert(1)", username: "a", password: "b" })],
    ["no password", encode({ v: 1, url: "https://h", username: "a", password: "" })],
  ])("rejects %s", (_label, input) => {
    expect(decodePairing(input as string | undefined)).toBeNull();
  });
});
