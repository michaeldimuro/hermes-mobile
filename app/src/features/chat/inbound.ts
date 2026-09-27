/**
 * Rows stored with role "user" that the user did not type. Hermes Bot Mode delivers teammate
 * messages, Kanban task updates and background-process notices into a bot's chat as user turns;
 * showing them as the user's own bubbles misattributes them, so they get their own shapes.
 */
export type Inbound =
  | { kind: "agent"; name: string; handle: string; text: string }
  | { kind: "task"; ok: boolean; handle?: string; title: string; detail: string }
  | { kind: "process"; ok: boolean; summary: string; detail: string };

const AGENT_RE = /^Message from (?:[^\p{L}\p{N}(]*\s*)?(.+?) \(@([\w.-]+)\):\s*([\s\S]*)$/u;
const TASK_RE = /^([✔✓✖✗⚠])\s*(?:\[[^\]\n]*\]\s*)?([^\n]*)\n?([\s\S]*)$/u;
const TASK_HEAD_RE = /^@([\w.-]+)\s+Kanban\s+\S+\s+(\w+)\s*[—–:-]\s*(.*)$/u;
const PROCESS_RE = /^\[IMPORTANT: Background process (\S+) ([^.(]*?)\s*(?:\(exit code (-?\d+)\))?\.\s*([\s\S]*)$/u;

export function classifyInbound(text: string): Inbound | null {
  const agent = AGENT_RE.exec(text);
  if (agent) return { kind: "agent", name: agent[1].trim(), handle: agent[2], text: agent[3].trim() };

  const process = PROCESS_RE.exec(text);
  if (process) {
    const code = process[3] === undefined ? null : Number(process[3]);
    const state = process[2].trim();
    const ok = code === 0 || (code === null && /completed normally|finished|succeeded/i.test(state));
    return {
      kind: "process",
      ok,
      summary: ok ? "Background process finished" : `Background process ${state || "stopped"}${code === null ? "" : ` (exit ${code})`}`,
      detail: process[4].replace(/\]\s*$/, "").trim(),
    };
  }

  const task = TASK_RE.exec(text);
  if (task && /Kanban/.test(task[2])) {
    const head = TASK_HEAD_RE.exec(task[2].trim());
    const ok = task[1] === "✔" || task[1] === "✓";
    return {
      kind: "task",
      ok,
      handle: head?.[1],
      title: (head?.[3] ?? task[2]).trim() || (ok ? "Task done" : "Task update"),
      detail: task[3].trim(),
    };
  }
  return null;
}
