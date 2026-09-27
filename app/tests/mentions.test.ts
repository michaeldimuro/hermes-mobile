import { botHandle, mentionNote, resolveMentions, stripMentionNote } from "@/features/chat/mentions";
import type { ProfileRow } from "@/lib/gateway/types";

const bots: ProfileRow[] = [
  { name: "default", is_default: true },
  { name: "cto", ui_meta: { "hermes-bots": { title: "Chief Technology Officer" } } },
  { name: "researcher" },
  { name: "growth-specialist" },
];

describe("mentions", () => {
  it("uses desktop handles (default → hermes)", () => {
    expect(botHandle(bots[0])).toBe("hermes");
    expect(botHandle(bots[1])).toBe("cto");
  });

  it("resolves handles, names and slugged titles, deduped in order", () => {
    const found = resolveMentions("@researcher ask @hermes and @chief-technology-officer, then @researcher; mail a@b", bots);
    expect(found.map((bot) => bot.name)).toEqual(["researcher", "default", "cto"]);
    expect(resolveMentions("@growthspecialist @nobody", bots).map((bot) => bot.name)).toEqual(["growth-specialist"]);
  });

  it("builds the desktop-compatible note and strips it back out", () => {
    const note = mentionNote([bots[1], bots[0]]);
    expect(note).toContain('@cto = agent profile "cto" ("Chief Technology Officer")');
    expect(note).toContain('@hermes = agent profile "default"');
    expect(note).not.toContain("message_agent target");
    expect(stripMentionNote(`ping @cto${note}`)).toBe("ping @cto");
    expect(mentionNote([])).toBe("");
  });
});
