import { usePreferences } from "../preferences";
import type { Task } from "../tasks/types";

/** Whether the calendar shows tasks that are due: off at first; part of the person's preferences, so it follows the account. */
export function useShowTasks(): [boolean, (on: boolean) => void] {
  const { prefs, update } = usePreferences();
  return [prefs.show_tasks_on_schedule, (on) => update({ show_tasks_on_schedule: on })];
}

/**
 * The tasks with a due date from `from` to `to`, by day. With people picked, a task stays when one of them is on it or
 * when it is for the whole team: the same rule the server applies to events.
 */
export function tasksByDate(tasks: Task[], from: string, to: string, people: number[]): Map<string, Task[]> {
  const byDate = new Map<string, Task[]>();
  for (const task of tasks) {
    if (task.due_date === null || task.due_date < from || task.due_date > to) continue;
    if (people.length > 0 && task.people.length > 0 && !task.people.some((id) => people.includes(id))) continue;
    byDate.set(task.due_date, [...(byDate.get(task.due_date) ?? []), task]);
  }
  return byDate;
}
