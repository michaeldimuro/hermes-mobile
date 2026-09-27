/** Hermes Kanban plugin shapes (`/api/plugins/kanban/*`), trimmed to what the app reads. */
export type BoardSummary = {
  slug: string;
  name: string;
  icon?: string;
  color?: string;
  total: number;
  counts: Record<string, number>;
  is_current?: boolean;
  project_name?: string | null;
};

export type KanbanTask = {
  id: string;
  title: string;
  body?: string | null;
  assignee?: string | null;
  status: string;
  priority?: number;
  created_by?: string | null;
  created_at?: number;
  started_at?: number | null;
  completed_at?: number | null;
  result?: string | null;
  latest_summary?: string | null;
  last_failure_error?: string | null;
  session_id?: string | null;
  comment_count?: number;
  block_kind?: string | null;
  progress?: { done?: number; total?: number } | null;
};

export type BoardColumn = { name: string; tasks: KanbanTask[] };
export type Board = { columns: BoardColumn[]; assignees: string[]; latest_event_id: number };

export type KanbanComment = { id: number; author: string; body: string; created_at: number };
export type KanbanEvent = { id: number; kind: string; payload?: Record<string, unknown> | null; created_at: number };
export type TaskDetail = {
  task: KanbanTask;
  comments: KanbanComment[];
  events: KanbanEvent[];
  child_results?: { id: string; title: string; status: string; latest_summary?: string | null }[];
};
