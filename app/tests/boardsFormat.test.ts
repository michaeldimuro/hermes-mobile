import { defaultColumn, eventText, orderColumns, statusLabel } from "@/features/boards/format";
import type { BoardColumn } from "@/features/boards/types";

const col = (name: string, n: number): BoardColumn => ({
  name,
  tasks: Array.from({ length: n }, (_, i) => ({ id: `${name}${i}`, title: "t", status: name })),
});

describe("boards format", () => {
  it("orders columns by workflow and keeps unknown statuses last", () => {
    expect(orderColumns([col("done", 1), col("custom", 1), col("todo", 1), col("review", 0)]).map((c) => c.name)).toEqual([
      "todo",
      "review",
      "done",
      "custom",
    ]);
  });

  it("opens the column that needs attention first", () => {
    expect(defaultColumn([col("todo", 3), col("blocked", 1), col("done", 9)])).toBe("blocked");
    expect(defaultColumn([col("todo", 0), col("done", 2)])).toBe("done");
    expect(defaultColumn([])).toBe("todo");
  });

  it("labels statuses and events for people", () => {
    expect(statusLabel("todo")).toBe("To do");
    expect(statusLabel("needs_input")).toBe("Needs input");
    expect(eventText({ id: 1, kind: "commented", payload: { author: "ceo" }, created_at: 0 })).toBe("ceo commented");
    expect(eventText({ id: 2, kind: "blocked", created_at: 0 })).toBe("Blocked");
  });
});

