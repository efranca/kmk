import { useCallback, useState } from "react";

import type { Task } from "../tasks/types";

const STORAGE_KEY = "kmk.schedule.showTasks";

/** Whether the calendar shows tasks that are due: off at first, remembered in this browser (and still working for this visit when storage is blocked). */
export function useShowTasks(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const set = useCallback((next: boolean) => {
    setOn(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      /* the choice only lasts for this visit */
    }
  }, []);
  return [on, set];
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
