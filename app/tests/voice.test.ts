import { speakableText } from "@/features/chat/useVoice";

jest.mock("expo-audio", () => ({}));
jest.mock("@/lib/store/GatewayProvider", () => ({}));
jest.mock("@/features/chat/fileData", () => ({}));

describe("speakableText", () => {
  it("drops markdown syntax and code, keeping the words", () => {
    expect(speakableText("## Plan\n\n**Ship** the [release](https://x.y) today.\n\n```ts\nconst a = 1;\n```\n\n- done")).toBe(
      "Plan\nShip the release today.\n (code omitted) \n- done",
    );
  });
});
