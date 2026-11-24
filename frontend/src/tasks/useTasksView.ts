import { usePreferences } from "../preferences";

export type TasksView = "list" | "board";

/** List or board: part of the person's preferences, so it follows the account. */
export function useTasksView(): [TasksView, (view: TasksView) => void] {
  const { prefs, update } = usePreferences();
  return [prefs.tasks_view, (view) => update({ tasks_view: view })];
}
