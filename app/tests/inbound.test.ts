import { classifyInbound } from "@/features/chat/inbound";

describe("classifyInbound", () => {
  it("recognises teammate messages delivered by Bot Mode", () => {
    expect(classifyInbound("Message from 🤖 Chief Technology Officer (@cto): Plan is ready.\nDetails below.")).toEqual({
      kind: "agent",
      name: "Chief Technology Officer",
      handle: "cto",
      text: "Plan is ready.\nDetails below.",
    });
    expect(classifyInbound("Message from CFO (@cfo): ok")).toMatchObject({ kind: "agent", name: "CFO", handle: "cfo" });
  });

  it("recognises Kanban task updates", () => {
    const text = "✔ [portfolio-moe] @cto Kanban t_172ea62a done — CTO: GCHub remediation plan\nDelivered an evidence-backed plan.";
    expect(classifyInbound(text)).toEqual({
      kind: "task",
      ok: true,
      handle: "cto",
      title: "CTO: GCHub remediation plan",
      detail: "Delivered an evidence-backed plan.",
    });
    expect(classifyInbound("✖ [x] @qa Kanban t_1 failed — QA: smoke\nboom")).toMatchObject({ kind: "task", ok: false, handle: "qa" });
  });

  it("recognises background-process notices", () => {
    const text =
      "[IMPORTANT: Background process proc_94627543d717 completed normally (exit code 0).\nCommand: /usr/bin/python3 tool.py --run]";
    expect(classifyInbound(text)).toEqual({
      kind: "process",
      ok: true,
      summary: "Background process finished",
      detail: "Command: /usr/bin/python3 tool.py --run",
    });
    expect(classifyInbound("[IMPORTANT: Background process p1 failed (exit code 2). stderr: x]")).toMatchObject({
      kind: "process",
      ok: false,
      summary: "Background process failed (exit 2)",
    });
  });

  it("leaves ordinary user text alone", () => {
    expect(classifyInbound("Message from me: hi")).toBeNull();
    expect(classifyInbound("✔ looks good to me")).toBeNull();
    expect(classifyInbound("[IMPORTANT: The user has invoked the skill]")).toBeNull();
    expect(classifyInbound("Can you hear me?")).toBeNull();
  });
});
