// Date helpers for the Schedule. Dates are plain "YYYY-MM-DD" strings (a calendar day, no time zone); arithmetic is
// done at local noon so a daylight-saving change never moves a day.
import type { TFunction } from "i18next";
import type { RecurrenceRule, WeekdayCode } from "./types";

export const WEEKDAY_CODES: readonly WeekdayCode[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
/** Monday to Friday: what "Every weekday" repeats on. */
export const WORKDAYS: readonly WeekdayCode[] = WEEKDAY_CODES.slice(0, 5);

/** Whether these are exactly Monday to Friday, in any order. */
export const isWorkdays = (days: readonly WeekdayCode[]): boolean =>
  days.length === WORKDAYS.length && WORKDAYS.every((d) => days.includes(d));

const pad = (n: number) => String(n).padStart(2, "0");

function parse(date: string): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 12);
}

function iso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(date: string, n: number): string {
  const d = parse(date);
  d.setDate(d.getDate() + n);
  return iso(d);
}

/** Whole calendar days from `a` to `b` (negative when `b` is earlier); a daylight-saving change does not count. */
export function diffDays(a: string, b: string): number {
  const utc = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  return Math.round((utc(b) - utc(a)) / 86_400_000);
}

/** The same day `n` months later (or earlier); a day the month lacks becomes the month's last day. */
export function addMonths(date: string, n: number): string {
  const d = parse(date);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return iso(d);
}

/** The first day of the week containing `date`: 0 = Sunday, 1 = Monday. */
export function weekStart(date: string, firstDay: 0 | 1): string {
  const diff = (parse(date).getDay() - firstDay + 7) % 7;
  return addDays(date, -diff);
}

/** Six full weeks (42 days) that cover the month, `month` being 1 to 12. */
export function monthGrid(year: number, month: number, firstDay: 0 | 1): string[] {
  const start = weekStart(`${year}-${pad(month)}-01`, firstDay);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function isWeekend(date: string): boolean {
  const day = parse(date).getDay();
  return day === 0 || day === 6;
}

/** English weeks start on Sunday (as in Canada and the US); Portuguese, French and Spanish ones on Monday. */
export function firstDayOf(language: string): 0 | 1 {
  return language === "en" ? 0 : 1;
}

/** The company's time zone: "today", reminders and repeating events all follow it, not the device's. */
export const COMPANY_TIME_ZONE = "America/Toronto";

/** Today's date as the company sees it, in its own time zone (not the device's). */
export function todayIn(zone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** The time of day as the company sees it, "HH:MM" in its own time zone. */
export function timeIn(zone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
}

/** The weekday's name in the locale ("Thursday", "quinta-feira"). */
export function weekdayName(code: WeekdayCode, locale: string, style: "long" | "short" = "long"): string {
  const monday = new Date(2026, 10, 2, 12); // a Monday
  monday.setDate(monday.getDate() + WEEKDAY_CODES.indexOf(code));
  return new Intl.DateTimeFormat(locale, { weekday: style }).format(monday);
}

/** The weekday code of an ISO date. */
export function weekdayCodeOf(date: string): WeekdayCode {
  return WEEKDAY_CODES[(parse(date).getDay() + 6) % 7]!;
}

const NTH = ["schRepeatNth1", "schRepeatNth2", "schRepeatNth3", "schRepeatNth4", "schRepeatNth5"] as const;
const NTH_F = ["schRepeatNth1f", "schRepeatNth2f", "schRepeatNth3f", "schRepeatNth4f", "schRepeatNth5f"] as const;
const FEMININE: readonly WeekdayCode[] = ["MON", "TUE", "WED", "THU", "FRI"]; // Portuguese "segunda-feira"...

function joinList(items: string[], locale: string): string {
  return new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(items);
}

/** The rule in the person's words: "Every Thursday", "Every month on the 1st and 3rd Saturday". */
export function describeRepeat(rule: RecurrenceRule, t: TFunction, locale: string): string {
  const every = rule.interval > 1;
  const n = rule.interval;
  switch (rule.freq) {
    case "daily":
      return every ? t("schRepeatDailyEvery", { n }) : t("schRepeatDaily");
    case "weekly": {
      if (!every && isWorkdays(rule.weekdays)) return t("schRepeatWeekday");
      const days = joinList(rule.weekdays.map((d) => weekdayName(d, locale)), locale);
      return every ? t("schRepeatWeeklyEvery", { n, days }) : t("schRepeatWeekly", { days });
    }
    case "monthly": {
      if (rule.month_day != null) {
        const day = rule.month_day;
        return every ? t("schRepeatMonthlyDayEvery", { n, day }) : t("schRepeatMonthlyDay", { day });
      }
      // "1st and 3rd Saturday": the ordinals of one weekday are grouped before its name
      const groups = new Map<WeekdayCode, number[]>();
      for (const e of rule.nth_weekdays) groups.set(e.day, [...(groups.get(e.day) ?? []), e.nth]);
      const list = joinList([...groups].map(([day, nths]) => {
        const feminine = FEMININE.includes(day);
        const ordinals = nths.map((nth) => t((feminine ? NTH_F : NTH)[nth - 1]!));
        return `${joinList(ordinals, locale)} ${weekdayName(day, locale)}`;
      }), locale);
      return every ? t("schRepeatMonthlyNthEvery", { n, list }) : t("schRepeatMonthlyNth", { list });
    }
    case "yearly":
      return every ? t("schRepeatYearlyEvery", { n }) : t("schRepeatYearly");
  }
}
