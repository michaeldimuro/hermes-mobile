import { shareDraft, stageShare, takeShare } from "@/features/share/pendingShare";

describe("pending share", () => {
  it("hands a staged share to the chosen bot's new chat exactly once", () => {
    stageShare({ bot: "cto", note: "Summarise", items: [{ kind: "url", value: "https://x.dev/a" }, { kind: "image", value: "file:///a.jpg" }] });
    expect(takeShare("cfo")).toBeNull();
    const share = takeShare("cto");
    expect(share && shareDraft(share)).toBe("Summarise\n\nhttps://x.dev/a");
    expect(takeShare("cto")).toBeNull();
  });
});
