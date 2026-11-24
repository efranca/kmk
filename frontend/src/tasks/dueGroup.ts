import { addDays } from "../schedule/scheduleDates";

export type DueGroup = "overdue" | "today" | "week" | "later";

/** Which heading a pending task sorts under: overdue, today, the next 7 days, or later. Dates are YYYY-MM-DD. */
export function dueGroup(due: string, today: string): DueGroup {
  if (due < today) return "overdue";
  if (due === today) return "today";
  return due <= addDays(today, 7) ? "week" : "later";
}
