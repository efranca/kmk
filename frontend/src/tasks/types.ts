// The tasks API (backend/app/tasks). Dates are ISO strings; `people` empty = the whole team.
export type TaskStatus = "pending" | "in_progress" | "completed";
export type StatusFilter = TaskStatus | "all";
export type UserRef = { id: number; name: string };

export type Task = {
  id: number;
  title: string;
  description: string | null;
  icon: string | null;
  category_id: number | null;
  client_id?: number | null;
  people: number[];
  status: TaskStatus;
  due_date: string | null;
  completed_at: string | null;
  show_on_dashboard: boolean;
  /** null = made by the website (a quote request). */
  created_by: UserRef | null;
  /** The server's answer to "may I edit or delete this?" (Staff only move and complete what an administrator made). */
  editable?: boolean;
  updated_by: UserRef | null;
  created_at: string;
  updated_at: string;
};

/** The body of POST and PATCH /api/tasks. */
export type TaskInput = {
  title: string;
  description: string | null;
  icon: string | null;
  category_id: number | null;
  client_id: number | null;
  people: number[];
  due_date: string | null;
  show_on_dashboard: boolean;
};

export type Category = { id: number; name: string; icon: string | null };
export type CategoryInput = { name: string; icon: string | null };
