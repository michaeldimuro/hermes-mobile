import type { Palette } from "@/ui/theme";
import type { BoardColumn, KanbanEvent } from "./types";

/** Board columns in working order; statuses Hermes adds later still show, after these. */
export const STATUS_ORDER = ["triage", "todo", "scheduled", "ready", "running", "blocked", "review", "done", "archived"];

const LABELS: Record<string, string> = {
  triage: "Triage",
  todo: "To do",
  scheduled: "Scheduled",
  ready: "Ready",
  running: "Running",
  blocked: "Blocked",
  review: "Review",
  done: "Done",
  archived: "Archived",
};

export const statusLabel = (status: string) =>
  LABELS[status] ?? status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, " ");

export function statusTone(status: string, colors: Palette) {
  if (status === "running") return colors.accentText;
  if (status === "blocked") return colors.danger;
  if (status === "review") return colors.warn;
  if (status === "done") return colors.success;
  return colors.muted;
}

/** Statuses a person can move a task to from the app (the server refuses invalid transitions). */
export const MOVE_TARGETS = ["todo", "ready", "blocked", "review", "done", "archived"];

/** The column to open first: whatever needs attention (review, blocked, running), else the first non-empty. */
export function defaultColumn(columns: BoardColumn[]) {
  for (const name of ["review", "blocked", "running", "ready", "todo"]) {
    if (columns.find((column) => column.name === name)?.tasks.length) return name;
  }
  return columns.find((column) => column.tasks.length)?.name ?? columns[0]?.name ?? "todo";
}

export function orderColumns(columns: BoardColumn[]) {
  const rank = (name: string) => {
    const index = STATUS_ORDER.indexOf(name);
    return index < 0 ? STATUS_ORDER.length : index;
  };
  return [...columns].sort((a, b) => rank(a.name) - rank(b.name));
}

/** One line for a task event ("assigned → cto", "moved to review"). */
export function eventText(event: KanbanEvent) {
  const p = event.payload ?? {};
  const who = typeof p.author === "string" ? p.author : typeof p.assignee === "string" ? p.assignee : "";
  switch (event.kind) {
    case "commented":
      return `${who || "Someone"} commented`;
    case "assigned":
      return who ? `Assigned to ${who}` : "Unassigned";
    case "status":
    case "status_changed":
      return typeof p.to === "string" ? `Moved to ${statusLabel(p.to)}` : "Status changed";
    default:
      return event.kind.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  }
}
