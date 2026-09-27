import { identifierType, loginParams, siteLabel, toOrigin } from "@/features/vault/vaultFormat";

jest.mock("@/lib/store/GatewayProvider", () => ({}));

describe("vault helpers", () => {
  it("turns what people type into the origin Hermes binds a login to", () => {
    expect(toOrigin("github.com")).toBe("https://github.com");
    expect(toOrigin("https://app.example.com/login?next=/")).toBe("https://app.example.com");
    expect(toOrigin("http://localhost:3000/x")).toBe("http://localhost:3000");
    expect(toOrigin("not a site")).toBeNull();
    expect(toOrigin("")).toBeNull();
  });

  it("classifies identifiers like Hermes does", () => {
    expect(identifierType("me@example.com")).toBe("email");
    expect(identifierType("+1 415 555 0100")).toBe("phone");
    expect(identifierType("octocat")).toBe("username");
  });

  it("builds vault.add params and explains what's missing", () => {
    expect(loginParams({ label: "", website: "www.github.com", identifier: " me@x.io ", password: "p w", otpSecret: "abcd efgh" })).toEqual({
      params: {
        kind: "login",
        label: "github.com",
        origin: "https://www.github.com",
        secret: { identifier_type: "email", identifier: "me@x.io", password: "p w", otp_secret: "abcdefgh" },
      },
    });
    expect(loginParams({ label: "", website: "", identifier: "a", password: "b", otpSecret: "" })).toEqual({ error: "Enter the website, e.g. github.com." });
    expect(siteLabel("https://www.example.com")).toBe("example.com");
  });
});
