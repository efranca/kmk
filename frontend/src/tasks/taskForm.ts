// Task form state and rules for the task dialog. No React in here: easy to test.
import type { Task, TaskInput } from "./types";

export const TITLE_MAX = 200;
export const DESCRIPTION_MAX = 2000;

export interface TaskFormValues {
  title: string;
  icon: string; // "" = none, else one emoji
  description: string;
  categoryId: number | null;
  people: number[]; // empty = the whole team
  dueDate: string; // "" = none, else YYYY-MM-DD
  showOnDashboard: boolean;
}

/** The values are the locale keys of the messages. */
export type TaskFormErrors = { title?: "taskErrTitle"; description?: "taskErrDescription" };

export const emptyTaskForm = (people: number[] = []): TaskFormValues => ({
  title: "", icon: "", description: "", categoryId: null, people, dueDate: "", showOnDashboard: true,
});

export const taskToForm = (t: Task): TaskFormValues => ({
  title: t.title, icon: t.icon ?? "", description: t.description ?? "", categoryId: t.category_id,
  people: t.people, dueDate: t.due_date ?? "", showOnDashboard: t.show_on_dashboard,
});

export function validateTaskForm(v: TaskFormValues): TaskFormErrors {
  const errors: TaskFormErrors = {};
  if (!v.title.trim() || v.title.trim().length > TITLE_MAX) errors.title = "taskErrTitle";
  if (v.description.trim().length > DESCRIPTION_MAX) errors.description = "taskErrDescription";
  return errors;
}

export function formToInput(v: TaskFormValues): TaskInput {
  return {
    title: v.title.trim(),
    description: v.description.trim() || null,
    icon: v.icon || null,
    category_id: v.categoryId,
    people: v.people,
    due_date: v.dueDate || null,
    show_on_dashboard: v.showOnDashboard,
  };
}
