import { daySeries } from "@/features/usage/useUsage";

jest.mock("@/lib/store/GatewayProvider", () => ({}));

describe("usage day series", () => {
  it("fills the whole period, zero on quiet days", () => {
    const usage = { daily: [{ day: "2026-09-24", input_tokens: 10, output_tokens: 5, sessions: 1, api_calls: 1 }] };
    expect(daySeries(usage, 3, new Date(2026, 8, 25))).toEqual([0, 15, 0]);
  });
});
