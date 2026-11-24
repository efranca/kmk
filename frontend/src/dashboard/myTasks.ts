import { COMPANY_TIME_ZONE, todayIn } from "../schedule/scheduleDates";
import type { Task } from "../tasks/types";

export type TaskSections = { overdue: Task[]; today: Task[]; doneToday: Task[]; noDate: Task[]; tomorrow: Task[] };

/**
 * What the Dashboard's "My tasks" card lists: the tasks I am on plus the whole team's (no people), that are not kept
 * off the Dashboard. A finished task stays, struck through, for the day it was finished (in the company time zone).
 */
export function myTaskSections(tasks: Task[], userId: number, today: string, tomorrow: string): TaskSections {
  const mine = tasks.filter((x) => x.show_on_dashboard && (x.people.length === 0 || x.people.includes(userId)));
  const pending = mine.filter((x) => x.status !== "completed");
  const finishedDay = (x: Task) => (x.completed_at ? todayIn(COMPANY_TIME_ZONE, new Date(x.completed_at)) : null);
  return {
    overdue: pending.filter((x) => x.due_date !== null && x.due_date < today),
    today: pending.filter((x) => x.due_date === today),
    doneToday: mine.filter((x) => x.status === "completed" && (x.due_date === today || finishedDay(x) === today)),
    noDate: pending.filter((x) => x.due_date === null),
    tomorrow: pending.filter((x) => x.due_date === tomorrow),
  };
}
