// What the schedule API sends and receives (see backend/app/schedule). Dates are "YYYY-MM-DD", times "HH:MM", wall-clock
// values in the company time zone; a person is a user id.
import type { EventColor } from "../ui/memberColor";

export type WeekdayCode = "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";
export type Freq = "daily" | "weekly" | "monthly" | "yearly";
export type ReminderUnit = "hours" | "days" | "weeks";
export type Scope = "this" | "following" | "all";

export interface RecurrenceRule {
  freq: Freq;
  interval: number;
  weekdays: WeekdayCode[];
  month_day: number | null;
  nth_weekdays: { nth: number; day: WeekdayCode }[];
}

export interface ReminderIn {
  amount: number;
  unit: ReminderUnit;
}

/** One day of an event (or of a repeating series), as the listing returns it. `people` empty = everyone. */
export interface Occurrence {
  event_id: number;
  original_date: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  all_day: boolean;
  title: string;
  notes: string | null;
  icon: string | null;
  color: EventColor;
  repeating: boolean;
  modified: boolean;
  people: number[];
  created_by: number | null;
}

/** "This occurrence only" change of a repeating event (cancelled, or title, notes, date, time and length overridden). */
export interface EventException {
  original_date: string;
  cancelled: boolean;
  title: string | null;
  notes: string | null;
  start_date: string | null;
  start_time: string | null;
  duration_minutes: number | null;
}

export interface EventDetail {
  id: number;
  title: string;
  notes: string | null;
  icon: string | null;
  color: EventColor | null;
  display_color: EventColor;
  all_day: boolean;
  start_date: string;
  start_time: string | null;
  duration_minutes: number | null;
  recurrence: RecurrenceRule | null;
  ends_on: string | null;
  max_count: number | null;
  people: number[];
  reminders: ReminderIn[];
  exceptions: EventException[];
  created_by: number | null;
  updated_by: number;
}

/** The body of a create or change. */
export interface EventInput {
  title: string;
  notes: string | null;
  icon: string | null;
  color: EventColor | null;
  all_day: boolean;
  start_date: string;
  start_time: string | null;
  duration_minutes: number | null;
  recurrence: RecurrenceRule | null;
  ends_on: string | null;
  max_count: number | null;
  people: number[];
  reminders: ReminderIn[];
}

export interface DueReminder {
  event_id: number;
  occurrence_date: string;
  title: string;
  start_date: string;
  start_time: string | null;
  all_day: boolean;
  remind_at: string;
}
