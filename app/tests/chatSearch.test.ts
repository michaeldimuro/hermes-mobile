import { searchTimeline } from "@/features/chat/ChatSearch";
import { chatReducer, initialChatState } from "@/features/chat/chatReducer";

jest.mock("react-native-reanimated", () => ({}));
jest.mock("@/ui/primitives", () => ({}));
jest.mock("@/ui/motion", () => ({}));
jest.mock("@/ui/theme", () => ({ makeStyles: () => () => ({}), radius: {}, space: {}, useTheme: () => ({}) }));

describe("searchTimeline", () => {
  it("finds messages newest first and ignores one-letter queries", () => {
    const state = chatReducer(initialChatState, {
      type: "hydrate",
      messages: [
        { role: "user", text: "Plan the launch", row_id: 1 },
        { role: "assistant", text: "Launch plan: …", row_id: 2 },
        { role: "user", text: "thanks", row_id: 3 },
      ],
    });
    const newest = [...state.items].reverse();
    expect(searchTimeline(newest, "launch")).toEqual(["a-r2", "u-r1"]);
    expect(searchTimeline(newest, "l")).toEqual([]);
  });
});
