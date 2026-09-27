import React from "react";
import { TextInput } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { LoginRequestCard, loginAnswer } from "@/features/chat/LoginRequestCard";

jest.mock("expo-haptics", () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: {},
  NotificationFeedbackType: {},
}));

const request = { id: "srq-7", method: "vault.save_login", params: { origin: "https://github.com", site: "github.com" } };
const textOf = (tree: ReactTestRenderer) =>
  tree.root
    .findAll((node) => typeof node.props.children === "string" || Array.isArray(node.props.children))
    .map((node) => [node.props.children].flat().filter((c) => typeof c === "string").join(""))
    .join(" | ");

describe("LoginRequestCard", () => {
  it("names the bot and site, and sends {identifier, password} only when both are filled", () => {
    const onAnswer = jest.fn();
    const onDecline = jest.fn();
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<LoginRequestCard request={request} botName="CTO" onAnswer={onAnswer} onDecline={onDecline} />);
    });
    expect(textOf(tree)).toContain("CTO needs to sign in to github.com");
    expect(textOf(tree)).toContain("https://github.com");

    const [user, pass] = tree.root.findAllByType(TextInput);
    expect(pass.props.secureTextEntry).toBe(true);
    expect(pass.props.textContentType).toBe("password");
    act(() => pass.props.onSubmitEditing());
    expect(onAnswer).not.toHaveBeenCalled();

    act(() => user.props.onChangeText(" octocat "));
    act(() => pass.props.onChangeText("s3cret"));
    act(() => tree.root.findAllByType(TextInput)[1].props.onSubmitEditing());
    expect(onAnswer).toHaveBeenCalledWith("srq-7", { value: loginAnswer("octocat", "s3cret") });
    expect(JSON.parse(onAnswer.mock.calls[0][1].value)).toEqual({ identifier: "octocat", password: "s3cret" });
    act(() => tree.unmount());
  });
});
