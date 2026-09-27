import {
  AssistantItem,
  chatReducer,
  configPatch,
  ChatState,
  initialChatState,
  transcriptToItems,
} from "@/features/chat/chatReducer";
import type { GatewayEvent } from "@/lib/gateway/types";

const run = (events: GatewayEvent[], start: ChatState = initialChatState) =>
  events.reduce((state, event) => chatReducer(state, { type: "event", event }), start);

const lastAssistant = (state: ChatState) =>
  state.items.filter((item): item is AssistantItem => item.kind === "assistant").pop()!;

describe("chatReducer streaming", () => {
  it("accumulates deltas and finalizes on message.complete", () => {
    const sent = chatReducer(initialChatState, { type: "user", text: "hi" });
    const state = run(
      [
        { type: "message.start", payload: {} },
        { type: "message.delta", payload: { text: "Hel" } },
        { type: "message.delta", payload: { text: "lo" } },
        { type: "message.complete", payload: { text: "Hello!", status: "complete", usage: { total: 12 } } },
      ],
      sent,
    );
    expect(state.items).toHaveLength(2);
    const turn = lastAssistant(state);
    expect(turn.text).toBe("Hello!");
    expect(turn.streaming).toBe(false);
    expect(state.running).toBe(false);
    expect(state.usage?.total).toBe(12);
  });

  it("keeps streamed text when complete carries no text", () => {
    const state = run([
      { type: "message.delta", payload: { text: "partial" } },
      { type: "message.complete", payload: { status: "interrupted" } },
    ]);
    expect(lastAssistant(state).text).toBe("partial");
    expect(lastAssistant(state).status).toBe("interrupted");
  });

  it("tracks reasoning and tool lifecycle in one turn", () => {
    const state = run([
      { type: "message.start", payload: {} },
      { type: "reasoning.delta", payload: { text: "thinking…" } },
      { type: "tool.generating", payload: { name: "web_search" } },
      { type: "tool.start", payload: { tool_id: "t1", name: "web_search", context: "hermes" } },
      { type: "tool.complete", payload: { tool_id: "t1", name: "web_search", summary: "3 results", duration_s: 1.2 } },
    ]);
    const turn = lastAssistant(state);
    expect(turn.reasoning).toBe("thinking…");
    expect(turn.activity).toHaveLength(1);
    expect(turn.activity[0]).toMatchObject({ id: "t1", state: "done", summary: "3 results", context: "hermes" });
    expect(state.running).toBe(true);
  });

  it("moves already-streamed interim commentary into activity", () => {
    const state = run([
      { type: "message.delta", payload: { text: "Let me check." } },
      { type: "message.interim", payload: { text: "Let me check.", already_streamed: true } },
      { type: "message.delta", payload: { text: "Done" } },
    ]);
    const turn = lastAssistant(state);
    expect(turn.text).toBe("Done");
    expect(turn.activity).toEqual([expect.objectContaining({ kind: "note", text: "Let me check." })]);
  });

  it("treats thinking.delta as status and drops reasoning that echoes the answer", () => {
    const state = run([
      { type: "thinking.delta", payload: { text: "٩(๑❛ᴗ❛๑)۶ pondering..." } },
      { type: "reasoning.available", payload: { text: "Friday." } },
    ]);
    expect(state.statusLine).toBe("pondering...");
    const done = run([{ type: "message.complete", payload: { text: "Friday." } }], state);
    expect(lastAssistant(done).reasoning).toBe("");
    expect(done.statusLine).toBe("");
  });

  it("records errors as notices and stops running", () => {
    const state = run([
      { type: "message.delta", payload: { text: "x" } },
      { type: "error", payload: { message: "boom" } },
    ]);
    expect(state.running).toBe(false);
    expect(state.items[state.items.length - 1]).toMatchObject({ kind: "notice", level: "error", text: "boom" });
  });
});

describe("chatReducer side channels", () => {
  it("tracks subagents, todos, titles and cancelled requests", () => {
    let state = run([
      { type: "subagent.start", payload: { subagent_id: "s1", goal: "Research", task_index: 0, task_count: 1 } },
      { type: "subagent.tool", payload: { subagent_id: "s1", goal: "Research", tool_name: "browser", task_index: 0, task_count: 1 } },
      { type: "todo.updated", payload: { todos: [{ id: "1", content: "Plan", status: "completed" }], revision: 1 } },
      { type: "session.title", payload: { session_id: "x", title: "Trip plan" } },
    ]);
    expect(state.subagents.s1).toMatchObject({ status: "running", lastTool: "browser" });
    expect(state.todos).toEqual([{ id: "1", content: "Plan", status: "completed" }]);
    expect(state.title).toBe("Trip plan");

    state = chatReducer(state, { type: "request.add", request: { id: "srq-1", method: "approval", params: {} } });
    state = chatReducer(state, { type: "request.add", request: { id: "srq-1", method: "approval", params: {} } });
    expect(state.requests).toHaveLength(1);
    state = run([{ type: "request.cancel", payload: { id: "srq-1", method: "approval", reason: "timeout" } }], state);
    expect(state.requests).toHaveLength(0);
  });

  it("resolves /btw answers onto the pending side item", () => {
    let state = chatReducer(initialChatState, { type: "side.start", mode: "btw", question: "why?", localId: "L1" });
    state = chatReducer(state, { type: "side.task", localId: "L1", taskId: "task-9" });
    state = run([{ type: "btw.complete", payload: { task_id: "task-9", text: "because" } }], state);
    expect(state.items).toEqual([expect.objectContaining({ kind: "side", text: "because", pending: false })]);
  });
});

describe("transcriptToItems", () => {
  it("groups assistant and tool rows into one turn per user message", () => {
    const items = transcriptToItems([
      { role: "user", text: "find it" },
      { role: "assistant", text: "Looking." },
      { role: "tool", name: "search_files", context: "*.ts" },
      { role: "assistant", text: "Found it." },
      { role: "user", text: "thanks" },
      { role: "assistant", text: "Anytime." },
    ]);
    expect(items.map((item) => item.kind)).toEqual(["user", "assistant", "user", "assistant"]);
    const first = items[1] as AssistantItem;
    expect(first.text).toBe("Found it.");
    expect(first.activity.map((step) => step.kind)).toEqual(["note", "tool"]);
  });
});

describe("configPatch", () => {
  it("maps config.set answers onto live session info", () => {
    expect(configPatch("reasoning", "high", { key: "reasoning", value: "high" })).toEqual({ reasoning_effort: "high" });
    expect(configPatch("fast", "fast", { key: "fast", value: "fast" })).toEqual({ fast: true });
    expect(configPatch("fast", "normal", { key: "fast", value: "normal" })).toEqual({ fast: false });
    expect(configPatch("yolo", "on", { key: "yolo", value: "1", scope: "session" } as never)).toEqual({ yolo: true });
    expect(configPatch("yolo", "off", { key: "yolo", value: "0" })).toEqual({ yolo: false });
    expect(configPatch("model", "gpt-5.6-sol --provider openai-codex", { key: "model", value: "gpt-5.6-sol" })).toEqual({
      model: "gpt-5.6-sol",
      provider: "openai-codex",
    });
  });

  it("applies nothing while a model switch awaits confirmation", () => {
    expect(configPatch("model", "big --provider x", { confirm_required: true, confirm_message: "Costly" })).toBeNull();
  });
});

describe("reconcile", () => {
  it("adopts messages another client posted while keeping a streaming reply", () => {
    let state = chatReducer(initialChatState, { type: "hydrate", messages: [{ role: "user", text: "hi" }, { role: "assistant", text: "hello" }] });
    state = run([{ type: "message.start", payload: {} }, { type: "message.delta", payload: { text: "Work" } }], state);
    state = chatReducer(state, {
      type: "reconcile",
      messages: [
        { role: "user", text: "hi" },
        { role: "assistant", text: "hello" },
        { role: "user", text: "typed on desktop" },
      ],
    });
    expect(state.items.map((item) => (item.kind === "user" ? `u:${item.text}` : item.kind))).toEqual([
      "u:hi",
      "assistant",
      "u:typed on desktop",
      "assistant",
    ]);
    expect(lastAssistant(state).streaming).toBe(true);
    expect(lastAssistant(state).text).toBe("Work");
  });

  it("keeps local side answers and notices in place", () => {
    let state = chatReducer(initialChatState, { type: "hydrate", messages: [{ role: "user", text: "a" }, { role: "assistant", text: "b" }] });
    state = chatReducer(state, { type: "notice", text: "compressed" });
    state = chatReducer(state, {
      type: "reconcile",
      messages: [
        { role: "user", text: "a" },
        { role: "assistant", text: "b" },
        { role: "user", text: "c" },
        { role: "assistant", text: "d" },
      ],
    });
    expect(state.items.map((item) => item.kind)).toEqual(["user", "assistant", "notice", "user", "assistant"]);
  });
});

describe("stable transcript ids", () => {
  it("gives the same keys when the same transcript is loaded twice", () => {
    const rows = [
      { role: "user", text: "hi", row_id: 10 },
      { role: "assistant", text: "hello", row_id: 11 },
      { role: "user", text: "Message from CFO (@cfo): ok", row_id: 12 },
    ];
    const first = transcriptToItems(rows).map((item) => item.id);
    expect(transcriptToItems(rows).map((item) => item.id)).toEqual(first);
    expect(first).toEqual(["u-r10", "a-r11", "in-r12"]);
    expect(new Set(first).size).toBe(first.length);
  });
});

describe("edit & resend", () => {
  it("keeps transcript row ids on user items and stamps new ones", () => {
    let state = chatReducer(initialChatState, {
      type: "hydrate",
      messages: [
        { role: "user", text: "first", row_id: 1 },
        { role: "assistant", text: "one", row_id: 2 },
      ],
    });
    expect(state.items[0]).toMatchObject({ kind: "user", rowId: 1 });
    state = chatReducer(state, { type: "user", id: "u-local", text: "second" });
    state = chatReducer(state, { type: "stamp", id: "u-local", rowId: 3 });
    expect(state.items[2]).toMatchObject({ id: "u-local", rowId: 3 });
  });

  it("drops everything from the edited message on and posts the new text", () => {
    let state = chatReducer(initialChatState, {
      type: "hydrate",
      messages: [
        { role: "user", text: "a", row_id: 1 },
        { role: "assistant", text: "b", row_id: 2 },
        { role: "user", text: "c", row_id: 3 },
        { role: "assistant", text: "d", row_id: 4 },
      ],
    });
    state = chatReducer(state, { type: "rewind", fromId: "u-r3", text: "c2", id: "u-new" });
    expect(state.items.map((item) => (item.kind === "user" ? item.text : item.kind))).toEqual(["a", "assistant", "c2"]);
    expect(state.running).toBe(true);
    expect(chatReducer(state, { type: "rewind", fromId: "missing", text: "x" })).toBe(state);
  });
});

describe("file refs", () => {
  it("shows @file: references from stored turns as file chips", () => {
    const [item] = transcriptToItems([{ role: "user", text: "summarise this\n\n@file:`uploads/Q3 report.pdf`", row_id: 5 }]);
    expect(item).toMatchObject({ kind: "user", text: "summarise this", files: ["Q3 report.pdf"], rowId: 5 });
    const [quoted] = transcriptToItems([{ role: "user", text: 'read @file:"docs/My Notes.md" please' }]);
    expect(quoted).toMatchObject({ text: "read  please", files: ["My Notes.md"] });
  });
});
