import type {
  GatewayEvent,
  ServerRequest,
  SessionLiveInfo,
  TranscriptMessage,
  Usage,
} from "@/lib/gateway/types";
import { skillInvocationText } from "./composerText";
import { classifyInbound, type Inbound } from "./inbound";
import { stripMentionNote } from "./mentions";
import { type Attachment, detectToolFiles } from "@/features/media/detect";
import { mergeSides, splitFileRefs } from "./chatConfig";

/** Append newly found files, keeping each (by key) once. */
function addFiles(existing: Attachment[] | undefined, found: Attachment[]) {
  if (!found.length) return existing;
  const out = [...(existing ?? [])];
  for (const file of found) if (!out.some((item) => item.key === file.key)) out.push(file);
  return out;
}

export type ToolStep = {
  kind: "tool";
  id: string;
  name: string;
  context?: string;
  state: "generating" | "running" | "done";
  summary?: string;
  durationS?: number;
  diff?: string;
};
export type NoteStep = { kind: "note"; id: string; text: string };
export type ActivityStep = ToolStep | NoteStep;

/** `rowId` is the stored transcript row: the durable target for rewinding (edit & resend). */
export type UserItem = {
  kind: "user";
  id: string;
  text: string;
  images?: string[];
  /** Names of documents sent with the message. */
  files?: string[];
  createdAt?: number;
  rowId?: number;
};
export type AssistantItem = {
  kind: "assistant";
  id: string;
  text: string;
  reasoning: string;
  activity: ActivityStep[];
  streaming: boolean;
  status?: "complete" | "error" | "interrupted";
  error?: string;
  warning?: string;
  startedAt?: number;
  endedAt?: number;
  /** Files produced by tools during the turn (screenshots, generated images, exports…). */
  files?: Attachment[];
};
export type NoticeItem = { kind: "notice"; id: string; text: string; level: "info" | "warn" | "error" };
export type SideItem = {
  kind: "side";
  id: string;
  taskId?: string;
  mode: "btw" | "background";
  question: string;
  text: string;
  pending: boolean;
};
/** A turn Hermes delivered into this chat on someone else's behalf (teammate bot, task, process). */
export type InboundItem = { kind: "inbound"; id: string; inbound: Inbound };
export type TimelineItem = UserItem | AssistantItem | NoticeItem | SideItem | InboundItem;

export type Todo = { id?: string; content: string; status: string };
export type Subagent = {
  id: string;
  goal: string;
  status: string;
  model?: string;
  lastTool?: string;
  summary?: string;
  toolCount?: number;
};

export type ChatState = {
  items: TimelineItem[];
  running: boolean;
  statusLine: string;
  usage: Usage | null;
  info: SessionLiveInfo | null;
  title: string;
  todos: Todo[];
  subagents: Record<string, Subagent>;
  requests: ServerRequest[];
};

export type ChatAction =
  | { type: "reset" }
  | { type: "hydrate"; messages: TranscriptMessage[]; info?: SessionLiveInfo | null; running?: boolean; inflight?: string }
  | { type: "user"; text: string; images?: string[]; files?: string[]; at?: number; id?: string }
  /** Edit & resend: drop the timeline from this user message on and post `text` in its place. */
  | { type: "rewind"; fromId: string; text: string; id?: string; at?: number }
  /** Hermes stored the message: remember its row so it can be edited later. */
  | { type: "stamp"; id: string; rowId: number }
  | { type: "notice"; text: string; level?: NoticeItem["level"] }
  /** A local action finished without a model turn (e.g. /undo prefilling the composer). */
  | { type: "settle" }
  /**
   * Re-sync from the stored transcript (another client — e.g. Hermes desktop — posted into this
   * session). Keeps an in-flight streaming reply and local side items that the transcript lacks.
   */
  | { type: "reconcile"; messages: TranscriptMessage[] }
  | { type: "side.start"; mode: SideItem["mode"]; question: string; localId: string }
  | { type: "side.task"; localId: string; taskId: string }
  | { type: "request.add"; request: ServerRequest }
  | { type: "request.resolve"; id: string }
  | { type: "event"; event: GatewayEvent; now?: number };

export const initialChatState: ChatState = {
  items: [],
  running: false,
  statusLine: "",
  usage: null,
  info: null,
  title: "",
  todos: [],
  subagents: {},
  requests: [],
};

export { configPatch, splitFileRefs, type ConfigKey, type ConfigSetResult } from "./chatConfig";

let counter = 0;
const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

const str = (value: unknown) => (typeof value === "string" ? value : value == null ? "" : String(value));

function newAssistant(now?: number): AssistantItem {
  return { kind: "assistant", id: uid("a"), text: "", reasoning: "", activity: [], streaming: true, startedAt: now };
}

/** Return state with the live assistant turn updated (creating one if needed). */
function withTurn(state: ChatState, update: (turn: AssistantItem) => AssistantItem, now?: number): ChatState {
  const items = state.items.slice();
  const last = items[items.length - 1];
  if (last?.kind === "assistant" && last.streaming) items[items.length - 1] = update(last);
  else items.push(update(newAssistant(now)));
  return { ...state, items, running: true };
}

function upsertTool(activity: ActivityStep[], tool: ToolStep): ActivityStep[] {
  const index = activity.findIndex(
    (step) =>
      step.kind === "tool" &&
      (step.id === tool.id || (step.state === "generating" && step.name === tool.name)),
  );
  if (index < 0) return [...activity, tool];
  const next = activity.slice();
  next[index] = { ...(activity[index] as ToolStep), ...tool };
  return next;
}

export function transcriptToItems(messages: TranscriptMessage[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  let turn: AssistantItem | null = null;
  const flush = () => {
    if (turn) items.push({ ...turn, streaming: false, status: turn.status ?? "complete" });
    turn = null;
  };
  messages.forEach((message, index) => {
    const role = str(message.role);
    const text = str(message.text ?? message.content);
    // Ids come from the stored row (else its position), so re-syncing the same transcript yields the
    // same keys: the list keeps its rows (and its scroll position) instead of remounting everything.
    const key = typeof message.row_id === "number" ? `r${message.row_id}` : `i${index}`;
    if (role === "user") {
      flush();
      const inbound = text ? classifyInbound(text) : null;
      if (inbound) items.push({ kind: "inbound", id: `in-${key}`, inbound });
      else if (text) {
        const { body, files } = splitFileRefs(stripMentionNote(skillInvocationText(text) ?? text));
        items.push({
          kind: "user",
          id: `u-${key}`,
          text: body,
          files: files.length ? files : undefined,
          rowId: typeof message.row_id === "number" ? message.row_id : undefined,
        });
      }
      return;
    }
    if (role === "assistant" || role === "tool") {
      turn ??= { ...newAssistant(), id: `a-${key}`, streaming: false };
      const current: AssistantItem = turn;
      if (role === "tool") {
        current.files = addFiles(current.files, detectToolFiles(text));
        if (current.text) current.activity.push({ kind: "note", id: uid("n"), text: current.text });
        current.text = "";
        current.activity.push({
          kind: "tool",
          id: uid("t"),
          name: str(message.name) || "tool",
          context: str(message.context) || undefined,
          state: "done",
        });
      } else {
        if (message.reasoning) current.reasoning += str(message.reasoning);
        if (text) {
          if (current.text) current.activity.push({ kind: "note", id: uid("n"), text: current.text });
          current.text = text;
        }
      }
      return;
    }
    if (role === "system" && text) {
      flush();
      items.push({ kind: "notice", id: `s-${key}`, text, level: "info" });
    }
  });
  flush();
  return items;
}

const finalText = (turn: AssistantItem, text: unknown) =>
  typeof text === "string" && text.trim() ? text : turn.text;

/** Non-streaming providers can surface the answer itself as a "reasoning" block. */
const dropEcho = (reasoning: string, text: string) => (reasoning.trim() === text.trim() ? "" : reasoning);

function reduceEvent(state: ChatState, event: GatewayEvent, now?: number): ChatState {
  const p = event.payload ?? {};
  switch (event.type) {
    case "message.start":
      return withTurn(state, (turn) => turn, now);
    case "message.delta":
      return withTurn(state, (turn) => ({ ...turn, text: turn.text + str(p.text) }), now);
    case "message.interim": {
      const text = str(p.text).trim();
      if (!text) return state;
      return withTurn(
        state,
        (turn) => {
          const alreadyStreamed = Boolean(p.already_streamed);
          return {
            ...turn,
            text: alreadyStreamed ? "" : turn.text,
            activity: [...turn.activity, { kind: "note", id: uid("n"), text }],
          };
        },
        now,
      );
    }
    case "thinking.delta": {
      // Spinner status ("٩(๑❛ᴗ❛๑)۶ pondering..."), not model reasoning.
      const text = str(p.text).replace(/^[^A-Za-z]*\s/, "").trim();
      return text ? { ...state, statusLine: text } : state;
    }
    case "reasoning.delta":
      return withTurn(state, (turn) => ({ ...turn, reasoning: turn.reasoning + str(p.text) }), now);
    case "reasoning.available":
      return withTurn(state, (turn) => (turn.reasoning ? turn : { ...turn, reasoning: str(p.text) }), now);
    case "tool.generating":
      return withTurn(
        state,
        (turn) => ({
          ...turn,
          activity: upsertTool(turn.activity, { kind: "tool", id: uid("g"), name: str(p.name), state: "generating" }),
        }),
        now,
      );
    case "tool.start":
      return withTurn(
        state,
        (turn) => ({
          ...turn,
          activity: upsertTool(turn.activity, {
            kind: "tool",
            id: str(p.tool_id),
            name: str(p.name),
            context: str(p.context || p.preview || p.args_text) || undefined,
            state: "running",
          }),
        }),
        now,
      );
    case "tool.complete":
      return withTurn(
        state,
        (turn) => ({
          ...turn,
          files: addFiles(turn.files, detectToolFiles(p.result ?? p.result_text)),
          activity: upsertTool(turn.activity, {
            kind: "tool",
            id: str(p.tool_id),
            name: str(p.name),
            state: "done",
            summary: str(p.summary) || undefined,
            durationS: typeof p.duration_s === "number" ? p.duration_s : undefined,
            diff: str(p.inline_diff) || undefined,
          }),
        }),
        now,
      );
    case "message.complete": {
      const status = (p.status as AssistantItem["status"]) ?? (p.error ? "error" : "complete");
      const next = withTurn(
        state,
        (turn) => ({
          ...turn,
          text: finalText(turn, p.text),
          reasoning: dropEcho(turn.reasoning || str(p.reasoning), finalText(turn, p.text)),
          streaming: false,
          status,
          error: str(p.error || p.failure_reason) || undefined,
          warning: str(p.warning) || undefined,
          activity: turn.activity.map((step) =>
            step.kind === "tool" && step.state !== "done" ? { ...step, state: "done" } : step,
          ),
          endedAt: now,
        }),
        now,
      );
      return { ...next, running: false, statusLine: "", usage: (p.usage as Usage) ?? state.usage };
    }
    case "status.update":
      return { ...state, statusLine: str(p.text) };
    case "session.usage":
      return { ...state, usage: (p.usage as Usage) ?? state.usage };
    case "session.info":
      return { ...state, info: { ...(state.info ?? {}), ...p }, title: str(p.title) || state.title };
    case "session.title":
      return { ...state, title: str(p.title) || state.title };
    case "todo.updated":
      return {
        ...state,
        todos: (Array.isArray(p.todos) ? p.todos : []).map((todo: any) => ({
          id: todo?.id ? str(todo.id) : undefined,
          content: str(todo?.content ?? todo?.text ?? todo),
          status: str(todo?.status || "pending"),
        })),
      };
    case "subagent.spawn_requested":
    case "subagent.start":
    case "subagent.progress":
    case "subagent.tool":
    case "subagent.thinking":
    case "subagent.complete": {
      const id = str(p.subagent_id) || `${str(p.goal)}#${p.task_index ?? 0}`;
      const prior = state.subagents[id];
      const status =
        event.type === "subagent.complete"
          ? str(p.status) || "completed"
          : event.type === "subagent.spawn_requested"
            ? "queued"
            : "running";
      return {
        ...state,
        subagents: {
          ...state.subagents,
          [id]: {
            id,
            goal: str(p.goal) || prior?.goal || "Delegated task",
            status,
            model: str(p.model) || prior?.model,
            lastTool: str(p.tool_name) || prior?.lastTool,
            summary: str(p.summary) || prior?.summary,
            toolCount: typeof p.tool_count === "number" ? p.tool_count : prior?.toolCount,
          },
        },
      };
    }
    case "btw.complete":
    case "background.complete": {
      const taskId = str(p.task_id);
      const index = state.items.findIndex((item) => item.kind === "side" && item.taskId === taskId);
      const items = state.items.slice();
      if (index >= 0) items[index] = { ...(items[index] as SideItem), text: str(p.text), pending: false };
      else
        items.push({
          kind: "side",
          id: uid("b"),
          taskId,
          mode: event.type === "btw.complete" ? "btw" : "background",
          question: str(p.question),
          text: str(p.text),
          pending: false,
        });
      return { ...state, items };
    }
    case "error":
      return {
        ...state,
        running: false,
        statusLine: "",
        items: [
          ...state.items.map((item) =>
            item.kind === "assistant" && item.streaming ? { ...item, streaming: false, status: "error" as const } : item,
          ),
          { kind: "notice", id: uid("e"), text: str(p.message) || "Gateway error", level: "error" },
        ],
      };
    case "request.cancel":
      return { ...state, requests: state.requests.filter((request) => request.id !== str(p.id)) };
    default:
      return state;
  }
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "reset":
      return initialChatState;
    case "hydrate": {
      const items = transcriptToItems(action.messages);
      if (action.running && action.inflight !== undefined) items.push({ ...newAssistant(), text: action.inflight });
      return {
        ...initialChatState,
        items,
        info: action.info ?? null,
        title: str(action.info?.title),
        usage: action.info?.usage ?? null,
        running: Boolean(action.running),
      };
    }
    case "user":
      return {
        ...state,
        running: true,
        items: [...state.items, { kind: "user", id: action.id ?? uid("u"), text: action.text, images: action.images, files: action.files, createdAt: action.at }],
      };
    case "rewind": {
      const cut = state.items.findIndex((item) => item.id === action.fromId);
      if (cut < 0) return state;
      return {
        ...state,
        running: true,
        statusLine: "",
        items: [...state.items.slice(0, cut), { kind: "user", id: action.id ?? uid("u"), text: action.text, createdAt: action.at }],
      };
    }
    case "stamp":
      return {
        ...state,
        items: state.items.map((item) => (item.id === action.id && item.kind === "user" ? { ...item, rowId: action.rowId } : item)),
      };
    case "notice":
      return {
        ...state,
        items: [...state.items, { kind: "notice", id: uid("i"), text: action.text, level: action.level ?? "info" }],
      };
    case "settle":
      return { ...state, running: false, statusLine: "" };
    case "reconcile": {
      const items = transcriptToItems(action.messages);
      const last = state.items[state.items.length - 1];
      // The stored transcript can't hold a reply that is still streaming; carry it over.
      if (last?.kind === "assistant" && last.streaming) {
        const stored = items[items.length - 1];
        if (stored?.kind === "assistant") items.pop();
        items.push(last);
      }
      const sides = state.items.filter((item) => item.kind === "side" || item.kind === "notice");
      return { ...state, items: sides.length ? mergeSides(items, sides, state.items) : items };
    }
    case "side.start":
      return {
        ...state,
        items: [
          ...state.items,
          { kind: "side", id: action.localId, mode: action.mode, question: action.question, text: "", pending: true },
        ],
      };
    case "side.task":
      return {
        ...state,
        items: state.items.map((item) =>
          item.kind === "side" && item.id === action.localId ? { ...item, taskId: action.taskId } : item,
        ),
      };
    case "request.add":
      if (state.requests.some((request) => request.id === action.request.id)) return state;
      return { ...state, requests: [...state.requests, action.request] };
    case "request.resolve":
      return { ...state, requests: state.requests.filter((request) => request.id !== action.id) };
    case "event":
      return reduceEvent(state, action.event, action.now);
  }
}
