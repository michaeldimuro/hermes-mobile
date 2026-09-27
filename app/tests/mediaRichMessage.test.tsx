import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { RichMessage } from "@/features/media/RichMessage";

// jest.mock calls are hoisted above the imports by babel-jest.
const mockPush = jest.fn();
jest.mock("expo-router", () => ({ router: { push: (...args: unknown[]) => mockPush(...args) } }));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn(() => Promise.resolve({ type: "opened" })) }));
jest.mock("expo-image", () => ({ Image: "ExpoImage" }));
jest.mock("expo-haptics", () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: {},
  NotificationFeedbackType: {},
}));
jest.mock("@/lib/store/GatewayProvider", () => ({
  useGateway: () => ({ config: { url: "http://gw:9119", token: "t" } }),
}));
const mockFetchToLocal = jest.fn(() => new Promise(() => undefined));
jest.mock("@/features/media/cache", () => ({
  fetchToLocal: (...args: unknown[]) => (mockFetchToLocal as jest.Mock)(...args),
  peekLocal: () => null,
  streamsWithHeaders: true,
}));

function render(element: React.ReactElement) {
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = create(element);
  });
  return tree as ReactTestRenderer;
}

const text = "Here is the chart:\n\nMEDIA:/tmp/chart.png\n\nSource: https://example.com/post\n\n![shot](/tmp/shot.png)";

describe("RichMessage", () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockFetchToLocal.mockClear();
    global.fetch = jest.fn(() => new Promise(() => undefined)) as unknown as typeof fetch;
  });

  it("renders cards for MEDIA files, strips the directive, and defers network work while streaming", () => {
    const tree = render(<RichMessage text={text} profile="default" sessionId="s1" markdownStyle={{}} streaming />);
    const labels = tree.root.findAll((node) => typeof node.props.accessibilityLabel === "string").map((n) => n.props.accessibilityLabel);
    expect(labels).toEqual(expect.arrayContaining(["Open image shot", "Open Image chart.png"]));
    const texts = JSON.stringify(tree.toJSON());
    expect(texts).not.toContain("MEDIA:");
    expect(mockFetchToLocal).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it("downloads thumbnails once settled and opens the viewer with profile/session scope", () => {
    jest.useFakeTimers();
    const tree = render(<RichMessage text={text} profile="cto" sessionId="s9" markdownStyle={{}} />);
    expect(mockFetchToLocal).toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(900);
    });
    expect(global.fetch).toHaveBeenCalledWith("https://example.com/post", expect.anything());
    const card = tree.root.find((node) => node.props.accessibilityLabel === "Open Image chart.png" && node.props.onPress);
    act(() => card.props.onPress());
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/viewer",
      params: { path: "/tmp/chart.png", kind: "image", name: "chart.png", profile: "cto", session: "s9" },
    });
    act(() => tree.unmount());
    jest.useRealTimers();
  });
});
