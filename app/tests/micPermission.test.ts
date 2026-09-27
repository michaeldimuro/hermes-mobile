const mockGet = jest.fn();
const mockRequest = jest.fn(async () => ({ granted: true, status: "granted" }));
jest.mock("expo-audio", () => ({ getRecordingPermissionsAsync: () => mockGet(), requestRecordingPermissionsAsync: () => mockRequest() }));

// eslint-disable-next-line import/first
import { ensureMicPermission } from "@/features/voice/micPermission";

beforeEach(() => mockRequest.mockClear());

describe("ensureMicPermission (iOS)", () => {
  it("asks when iOS hasn't asked yet", async () => {
    mockGet.mockResolvedValue({ granted: false, status: "undetermined" });
    await expect(ensureMicPermission()).resolves.toBe(true);
    expect(mockRequest).toHaveBeenCalled();
  });

  it("never asks when the build can't (no usage description reads as denied), so iOS can't kill the app", async () => {
    mockGet.mockResolvedValue({ granted: false, status: "denied" });
    await expect(ensureMicPermission()).resolves.toBe(false);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("skips the prompt when already allowed", async () => {
    mockGet.mockResolvedValue({ granted: true, status: "granted" });
    await expect(ensureMicPermission()).resolves.toBe(true);
    expect(mockRequest).not.toHaveBeenCalled();
  });
});
