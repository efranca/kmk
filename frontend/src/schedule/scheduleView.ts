// Which part of the calendar is on screen lives in the URL (?view=week&date=2026-11-12&people=3,5&q=...), so it
// survives reloads and the back button. "people" is only a filter: it never changes who is signed in.
import { useCallback } from "react";
import { useSearchParams } from "react-router";
import { COMPANY_TIME_ZONE, addDays, addMonths, monthGrid, todayIn, weekStart } from "./scheduleDates";

export type ScheduleViewKind = "day" | "week" | "month" | "year";
const KINDS: readonly ScheduleViewKind[] = ["day", "week", "month", "year"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface ScheduleView {
  view: ScheduleViewKind;
  /** The day the view is built around (YYYY-MM-DD). */
  date: string;
  /** The user ids whose events are shown; empty for everyone. */
  people: number[];
  /** The search text (empty when not searching). */
  q: string;
  /** Today in the company's time zone. */
  today: string;
  set: (changes: { view?: ScheduleViewKind; date?: string; people?: number[]; q?: string }) => void;
}

export function useScheduleView(): ScheduleView {
  const [params, setParams] = useSearchParams();
  const today = todayIn(COMPANY_TIME_ZONE);
  const rawView = params.get("view");
  const rawDate = params.get("date");
  const view = KINDS.find((k) => k === rawView) ?? "week";
  const date = rawDate && DATE.test(rawDate) ? rawDate : today;
  const people = (params.get("people") ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const q = params.get("q") ?? "";

  const set = useCallback<ScheduleView["set"]>((changes) => {
    setParams((p) => {
      const next = new URLSearchParams(p);
      if (changes.view) next.set("view", changes.view);
      if (changes.date) next.set("date", changes.date);
      if (changes.people !== undefined) {
        if (changes.people.length > 0) next.set("people", changes.people.join(","));
        else next.delete("people");
      }
      if (changes.q !== undefined) {
        if (changes.q) next.set("q", changes.q);
        else next.delete("q");
      }
      return next;
    }, { replace: true });
  }, [setParams]);

  return { view, date, people, q, today, set };
}

/** The day to show after stepping one view-length back (-1) or forward (+1); a phone's week is three days long. */
export function shiftDate(view: ScheduleViewKind, date: string, direction: -1 | 1, narrow = false): string {
  switch (view) {
    case "day": return addDays(date, direction);
    case "week": return addDays(date, (narrow ? 3 : 7) * direction);
    case "month": return addMonths(date, direction);
    case "year": return addMonths(date, 12 * direction);
  }
}

/** The first and last day the view needs from the server (a month view includes the neighbours' days in its grid). */
export function visibleRange(view: ScheduleViewKind, date: string, firstDay: 0 | 1, narrow = false): [string, string] {
  switch (view) {
    case "day": return [date, date];
    case "week": {
      if (narrow) return [date, addDays(date, 2)];
      const start = weekStart(date, firstDay); return [start, addDays(start, 6)]; }
    case "month": {
      const grid = monthGrid(Number(date.slice(0, 4)), Number(date.slice(5, 7)), firstDay);
      return [grid[0]!, grid[41]!];
    }
    case "year": return [`${date.slice(0, 4)}-01-01`, `${date.slice(0, 4)}-12-31`];
  }
}
