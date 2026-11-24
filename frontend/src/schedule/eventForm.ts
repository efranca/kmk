// Event form state and rules, shared by the event dialog. No React in here: easy to test, components stay presentational.
import type { EventDetail, EventException, EventInput, RecurrenceRule, ReminderIn, WeekdayCode } from "./types";
import type { EventColor } from "../ui/memberColor";
import { WEEKDAY_CODES, WORKDAYS, isWorkdays, weekdayCodeOf } from "./scheduleDates";

export type { EventException };

export const MAX_REMINDERS = 10;
export const EVENT_TITLE_MAX = 200;

export interface RepeatForm {
  mode: "none" | "daily" | "weekly" | "monthly" | "yearly";
  /** Every N days, weeks, months or years. */
  interval: number;
  weekdays: WeekdayCode[];
  /** Monthly: on a day of the month, or on the Nth weekday(s). */
  monthlyBy: "day" | "nth";
  monthDay: number;
  nth: { nth: number; day: WeekdayCode }[];
  end: "never" | "on" | "after";
  endsOn: string; // YYYY-MM-DD
  count: number;
}

export interface EventFormValues {
  title: string;
  notes: string;
  icon: string; // "" = none, else one emoji
  color: EventColor | ""; // "" = automatic
  allDay: boolean;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // "" = none (the event lasts one hour); sent to the server as a length in minutes
  people: number[]; // user ids; empty = everyone
  repeat: RepeatForm;
  reminders: ReminderIn[];
}

export type EventFormField =
  | "title" | "date" | "startTime" | "endTime" | "weekdays" | "nth" | "monthDay" | "endsOn" | "count" | "reminders";
export type EventErrorKey =
  | "schErrorsTitle" | "schErrorsTitleLong" | "schErrorsStartTime" | "schErrorsEndTime"
  | "schErrorsWeekdays" | "schErrorsNth" | "schErrorsMonthDay" | "schErrorsEndsOn"
  | "schErrorsDateRule" | "schErrorsEndsOnBefore" | "schErrorsCount" | "schErrorsReminders";
export type EventFormErrors = Partial<Record<EventFormField, EventErrorKey>>;

export const emptyRepeat = (): RepeatForm => ({
  mode: "none", interval: 1, weekdays: [], monthlyBy: "day", monthDay: 1, nth: [], end: "never", endsOn: "", count: 10,
});

/** A new event on `date`, starting at `time` (default 09:00). */
export const emptyEventForm = (date: string, time = "09:00"): EventFormValues => ({
  title: "", notes: "", icon: "", color: "", allDay: false, date, startTime: time, endTime: "", people: [],
  repeat: emptyRepeat(), reminders: [],
});

const byWeek = (codes: WeekdayCode[]) => [...codes].sort((a, b) => WEEKDAY_CODES.indexOf(a) - WEEKDAY_CODES.indexOf(b));

/** The repeat rule the form describes, or null for "does not repeat". */
export function formToRule(r: RepeatForm): RecurrenceRule | null {
  if (r.mode === "none") return null;
  const rule: RecurrenceRule = { freq: r.mode, interval: r.interval, weekdays: [], month_day: null, nth_weekdays: [] };
  if (r.mode === "weekly") rule.weekdays = byWeek(r.weekdays);
  if (r.mode === "monthly") {
    if (r.monthlyBy === "day") rule.month_day = r.monthDay;
    else rule.nth_weekdays = [...r.nth].sort((a, b) => a.nth - b.nth || WEEKDAY_CODES.indexOf(a.day) - WEEKDAY_CODES.indexOf(b.day));
  }
  return rule;
}

export function toEventInput(v: EventFormValues): EventInput {
  const recurrence = formToRule(v.repeat);
  const repeating = recurrence !== null;
  return {
    title: v.title.trim(),
    notes: v.notes.trim() || null,
    icon: v.icon || null,
    color: v.color || null,
    all_day: v.allDay,
    start_date: v.date,
    start_time: v.allDay ? null : v.startTime,
    duration_minutes: v.allDay || !v.endTime ? null : minutesBetween(v.startTime, v.endTime),
    people: v.people,
    recurrence,
    ends_on: repeating && v.repeat.end === "on" ? v.repeat.endsOn : null,
    max_count: repeating && v.repeat.end === "after" ? v.repeat.count : null,
    reminders: v.reminders.map((r) => ({ amount: r.amount, unit: r.unit })),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

const minutesOf = (time: string): number => {
  const [h, m] = time.split(":").map(Number) as [number, number];
  return h * 60 + m;
};

/** Minutes from `start` to `end` (both "HH:mm", the same day). */
const minutesBetween = (start: string, end: string): number => minutesOf(end) - minutesOf(start);

/** "HH:mm" plus minutes, or "" when it runs past the end of the day (an event ends the day it starts). */
function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number) as [number, number];
  const total = h * 60 + m + minutes;
  return total >= 24 * 60 ? "" : `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/**
 * The form for an existing event; `date` is the day shown (an occurrence's date), the series' own start by default.
 * `exception` is what "this event only" changed on that occurrence: the form shows the occurrence as it is now.
 */
export function fromEvent(e: EventDetail, date: string = e.start_date, exception?: EventException): EventFormValues {
  const rule = e.recurrence;
  const repeat: RepeatForm = rule
    ? {
        mode: rule.freq, interval: rule.interval, weekdays: rule.weekdays,
        monthlyBy: rule.month_day != null ? "day" : "nth", monthDay: rule.month_day ?? Number(date.slice(8, 10)),
        nth: rule.nth_weekdays, end: e.ends_on ? "on" : e.max_count ? "after" : "never",
        endsOn: e.ends_on ?? "", count: e.max_count ?? 10,
      }
    : emptyRepeat();
  const startTime = exception?.start_time ?? e.start_time ?? "09:00";
  const duration = exception?.duration_minutes ?? e.duration_minutes;
  const endTime = e.all_day || duration == null ? "" : addMinutes(startTime, duration);
  return {
    title: exception?.title ?? e.title, notes: exception?.notes ?? e.notes ?? "", icon: e.icon ?? "", color: e.color ?? "",
    allDay: e.all_day, date, startTime, endTime, people: e.people, repeat,
    reminders: e.reminders.map((r) => ({ amount: r.amount, unit: r.unit })),
  };
}

/** Whether the person changed something that belongs to the whole series (so "this event only" cannot carry it). */
export function seriesFieldsChanged(event: EventDetail, values: EventFormValues): boolean {
  const was = toEventInput(fromEvent(event));
  const now = toEventInput(values);
  const reminders = (list: ReminderIn[]) => list.map((r) => `${r.amount} ${r.unit}`).sort().join();
  return [...was.people].sort().join() !== [...now.people].sort().join()
    || reminders(was.reminders) !== reminders(now.reminders)
    || (was.icon ?? null) !== (now.icon ?? null) || (was.color ?? null) !== (now.color ?? null)
    || was.all_day !== now.all_day || JSON.stringify(was.recurrence) !== JSON.stringify(now.recurrence)
    || (was.ends_on ?? null) !== (now.ends_on ?? null) || (was.max_count ?? null) !== (now.max_count ?? null);
}

/**
 * Moving the date keeps a rule that followed the old date following the new one: a single weekday, the day of the month,
 * the lone "Nth weekday". A rule the person customised (two weekdays, another day) is left as it is.
 */
export function resyncRepeat(r: RepeatForm, oldDate: string, newDate: string): RepeatForm {
  const oldDay = Number(oldDate.slice(8, 10));
  const newDay = Number(newDate.slice(8, 10));
  if (r.mode === "weekly" && r.weekdays.length === 1 && r.weekdays[0] === weekdayCodeOf(oldDate)) {
    return { ...r, weekdays: [weekdayCodeOf(newDate)] };
  }
  if (r.mode === "monthly" && r.monthlyBy === "day" && r.monthDay === oldDay) return { ...r, monthDay: newDay };
  if (r.mode === "monthly" && r.monthlyBy === "nth" && r.nth.length === 1
    && r.nth[0]!.day === weekdayCodeOf(oldDate) && r.nth[0]!.nth === Math.ceil(oldDay / 7)) {
    return { ...r, nth: [{ nth: Math.min(5, Math.ceil(newDay / 7)), day: weekdayCodeOf(newDate) }] };
  }
  return r;
}

/** Whether the date is one of the days the repeat rule produces (always true for an event that does not repeat). */
export function dateFitsRule(v: EventFormValues): boolean {
  const r = v.repeat;
  const day = Number(v.date.slice(8, 10));
  if (r.mode === "weekly") return r.weekdays.includes(weekdayCodeOf(v.date));
  if (r.mode === "monthly") {
    return r.monthlyBy === "day" ? r.monthDay === day
      : r.nth.some((n) => n.day === weekdayCodeOf(v.date) && n.nth === Math.ceil(day / 7));
  }
  return true;
}

/** `requireDateInRule`: a new repeating event must start on one of its own days (an existing one is left to the server). */
export function validateEventForm(v: EventFormValues, opts: { requireDateInRule?: boolean } = {}): EventFormErrors {
  const errors: EventFormErrors = {};
  if (opts.requireDateInRule && !dateFitsRule(v)) errors.date = "schErrorsDateRule";
  const title = v.title.trim();
  if (!title) errors.title = "schErrorsTitle";
  else if ([...title].length > EVENT_TITLE_MAX) errors.title = "schErrorsTitleLong";
  if (!v.allDay) {
    if (!v.startTime) errors.startTime = "schErrorsStartTime";
    else if (v.endTime && v.endTime <= v.startTime) errors.endTime = "schErrorsEndTime";
  }
  const r = v.repeat;
  if (r.mode === "weekly" && r.weekdays.length === 0) errors.weekdays = "schErrorsWeekdays";
  if (r.mode === "monthly") {
    if (r.monthlyBy === "nth" && r.nth.length === 0) errors.nth = "schErrorsNth";
    if (r.monthlyBy === "day" && !(r.monthDay >= 1 && r.monthDay <= 31)) errors.monthDay = "schErrorsMonthDay";
  }
  if (r.mode !== "none") {
    if (r.end === "on") {
      if (!r.endsOn) errors.endsOn = "schErrorsEndsOn";
      else if (r.endsOn < v.date) errors.endsOn = "schErrorsEndsOnBefore";
    }
    if (r.end === "after" && !(r.count >= 1)) errors.count = "schErrorsCount";
  }
  const keys = v.reminders.map((x) => `${x.amount} ${x.unit}`);
  if (new Set(keys).size !== keys.length || v.reminders.some((x) => !(x.amount >= 1 && x.amount <= 99))) {
    errors.reminders = "schErrorsReminders";
  }
  return errors;
}

export const canAddReminder = (v: EventFormValues): boolean => v.reminders.length < MAX_REMINDERS;

/** A monthly rule on day 29 to 31 skips the months that lack that day; the form says so. */
export const monthDaySkipsMonths = (v: EventFormValues): boolean =>
  v.repeat.mode === "monthly" && v.repeat.monthlyBy === "day" && v.repeat.monthDay >= 29;

/** "Every weekday" is not a rule of its own: it is a weekly rule on Monday to Friday, every week. */
export const isEveryWeekday = (r: RepeatForm): boolean => r.mode === "weekly" && r.interval === 1 && isWorkdays(r.weekdays);

/** The form's repeat, set to every weekday (Monday to Friday). */
export const everyWeekday = (current: RepeatForm): RepeatForm => ({ ...current, mode: "weekly", interval: 1, weekdays: [...WORKDAYS] });

/** What switching the repeat mode should pre-fill so the rule is valid straight away (the date's own weekday and day). */
export function repeatDefaultsFor(mode: RepeatForm["mode"], date: string, current: RepeatForm): RepeatForm {
  const next: RepeatForm = { ...current, mode };
  if (mode === "weekly" && next.weekdays.length === 0) next.weekdays = [weekdayCodeOf(date)];
  if (mode === "monthly") {
    next.monthDay = Number(date.slice(8, 10));
    if (next.nth.length === 0) next.nth = [{ nth: Math.min(5, Math.ceil(Number(date.slice(8, 10)) / 7)), day: weekdayCodeOf(date) }];
  }
  return next;
}
