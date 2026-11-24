import type { EventDetail } from "./types";
import {
  MAX_REMINDERS, canAddReminder, dateFitsRule, emptyEventForm, everyWeekday, fromEvent, isEveryWeekday, monthDaySkipsMonths, resyncRepeat, seriesFieldsChanged, toEventInput,
  validateEventForm, type EventFormValues,
} from "./eventForm";
import { diffDays } from "./scheduleDates";

const base = (over: Partial<EventFormValues> = {}): EventFormValues => ({
  ...emptyEventForm("2026-11-05", "18:00"), title: "Swimming", ...over,
});

describe("every weekday", () => {
  const weekly = (weekdays: EventFormValues["repeat"]["weekdays"], interval = 1) =>
    ({ ...base().repeat, mode: "weekly" as const, interval, weekdays });

  it("isEveryWeekdayIsTrueOnlyForMondayToFridayEveryWeek", () => {
    expect(isEveryWeekday(weekly(["FRI", "MON", "WED", "TUE", "THU"]))).toBe(true);
    expect(isEveryWeekday(weekly(["MON", "TUE", "WED", "THU", "FRI"], 2))).toBe(false);
    expect(isEveryWeekday(weekly(["MON", "TUE", "WED", "THU", "FRI", "SAT"]))).toBe(false);
    expect(isEveryWeekday(weekly(["MON", "TUE", "WED", "THU"]))).toBe(false);
    expect(isEveryWeekday({ ...base().repeat, mode: "daily" })).toBe(false);
  });

  it("everyWeekdayBuildsAWeeklyMondayToFridayRule", () => {
    const input = toEventInput(base({ repeat: everyWeekday(base().repeat) }));
    expect(input.recurrence).toEqual({ freq: "weekly", interval: 1, weekdays: ["MON", "TUE", "WED", "THU", "FRI"], month_day: null, nth_weekdays: [] });
  });
});

describe("toEventInput", () => {
  it("swimmingEveryThursdayBuildsWeeklyThursdayRule", () => {
    const input = toEventInput(base({ repeat: { ...base().repeat, mode: "weekly", weekdays: ["THU"] } }));
    expect(input.recurrence).toEqual({ freq: "weekly", interval: 1, weekdays: ["THU"], month_day: null, nth_weekdays: [] });
    expect(input).toMatchObject({ title: "Swimming", all_day: false, start_date: "2026-11-05", start_time: "18:00", duration_minutes: null,
      people: [], ends_on: null, max_count: null, reminders: [] });
  });

  it("twiceAWeekIsTwoWeekdaysInWeekOrder", () => {
    const input = toEventInput(base({ repeat: { ...base().repeat, mode: "weekly", weekdays: ["THU", "TUE"] } }));
    expect(input.recurrence?.weekdays).toEqual(["TUE", "THU"]);
  });

  it("fourthSaturdayBuildsNthWeekdayRule", () => {
    const input = toEventInput(base({ repeat: { ...base().repeat, mode: "monthly", monthlyBy: "nth", nth: [{ nth: 4, day: "SAT" }] } }));
    expect(input.recurrence).toEqual({ freq: "monthly", interval: 1, weekdays: [], month_day: null, nth_weekdays: [{ nth: 4, day: "SAT" }] });
  });

  it("firstAndThirdSaturdayBuildsTwoNthWeekdays", () => {
    const input = toEventInput(base({ repeat: { ...base().repeat, mode: "monthly", monthlyBy: "nth",
      nth: [{ nth: 3, day: "SAT" }, { nth: 1, day: "SAT" }] } }));
    expect(input.recurrence?.nth_weekdays).toEqual([{ nth: 1, day: "SAT" }, { nth: 3, day: "SAT" }]);
  });

  it("monthlyOnADayUsesMonthDay", () => {
    const input = toEventInput(base({ repeat: { ...base().repeat, mode: "monthly", monthlyBy: "day", monthDay: 15, interval: 2 } }));
    expect(input.recurrence).toEqual({ freq: "monthly", interval: 2, weekdays: [], month_day: 15, nth_weekdays: [] });
  });

  it("dailyAndYearlyCarryOnlyAnInterval", () => {
    expect(toEventInput(base({ repeat: { ...base().repeat, mode: "daily", interval: 3 } })).recurrence)
      .toEqual({ freq: "daily", interval: 3, weekdays: [], month_day: null, nth_weekdays: [] });
    expect(toEventInput(base({ repeat: { ...base().repeat, mode: "yearly" } })).recurrence?.freq).toBe("yearly");
  });

  it("allDayHidesTimeFields", () => {
    const input = toEventInput(base({ allDay: true, startTime: "09:00", endTime: "10:00" }));
    expect(input.all_day).toBe(true);
    expect(input.start_time).toBeNull();
    expect(input.duration_minutes).toBeNull();
  });

  it("endsOnAndCountOnlyApplyToARepeatingEvent", () => {
    const rule = { ...base().repeat, mode: "weekly" as const, weekdays: ["THU" as const] };
    expect(toEventInput(base({ repeat: { ...rule, end: "on", endsOn: "2027-01-31" } })).ends_on).toBe("2027-01-31");
    expect(toEventInput(base({ repeat: { ...rule, end: "after", count: 8 } })).max_count).toBe(8);
    const single = toEventInput(base({ repeat: { ...base().repeat, mode: "none", end: "after", count: 8 } }));
    expect([single.recurrence, single.ends_on, single.max_count]).toEqual([null, null, null]);
  });

  it("trimsTextAndDropsEmptyOptionalFields", () => {
    const input = toEventInput(base({ title: "  Swimming  ", notes: "  ", icon: "", color: "" }));
    expect([input.title, input.notes, input.icon, input.color]).toEqual(["Swimming", null, null, null]);
  });
});

describe("validateEventForm", () => {
  it("timedEventRequiresStartTime", () => {
    expect(validateEventForm(base({ startTime: "" })).startTime).toBeDefined();
    expect(validateEventForm(base({ allDay: true, startTime: "" })).startTime).toBeUndefined();
  });

  it("endBeforeStartIsInvalid", () => {
    expect(validateEventForm(base({ startTime: "18:00", endTime: "17:00" })).endTime).toBeDefined();
    expect(validateEventForm(base({ startTime: "18:00", endTime: "18:00" })).endTime).toBeDefined();
    expect(validateEventForm(base({ startTime: "18:00", endTime: "19:30" })).endTime).toBeUndefined();
    expect(validateEventForm(base({ startTime: "18:00", endTime: "" })).endTime).toBeUndefined();
  });

  it("titleIsRequiredAndAtMost200Characters", () => {
    expect(validateEventForm(base({ title: "   " })).title).toBeDefined();
    expect(validateEventForm(base({ title: "x".repeat(201) })).title).toBeDefined();
    expect(validateEventForm(base({ title: "x".repeat(200) })).title).toBeUndefined();
  });

  it("aWeeklyRuleNeedsAWeekdayAndAMonthlyNthRuleNeedsAnEntry", () => {
    expect(validateEventForm(base({ repeat: { ...base().repeat, mode: "weekly", weekdays: [] } })).weekdays).toBeDefined();
    expect(validateEventForm(base({ repeat: { ...base().repeat, mode: "monthly", monthlyBy: "nth", nth: [] } })).nth).toBeDefined();
  });

  it("theEndDateMustNotBeBeforeTheStartAndACountIsAtLeastOne", () => {
    const rule = { ...base().repeat, mode: "weekly" as const, weekdays: ["THU" as const] };
    expect(validateEventForm(base({ repeat: { ...rule, end: "on", endsOn: "2026-11-01" } })).endsOn).toBeDefined();
    expect(validateEventForm(base({ repeat: { ...rule, end: "on", endsOn: "" } })).endsOn).toBeDefined();
    expect(validateEventForm(base({ repeat: { ...rule, end: "after", count: 0 } })).count).toBeDefined();
    expect(validateEventForm(base({ repeat: { ...rule, end: "on", endsOn: "2026-11-05" } })).endsOn).toBeUndefined();
  });

  it("theSameReminderTwiceIsInvalid", () => {
    const twice = [{ amount: 1, unit: "days" as const }, { amount: 1, unit: "days" as const }];
    expect(validateEventForm(base({ reminders: twice })).reminders).toBeDefined();
    expect(validateEventForm(base({ reminders: [twice[0]!, { amount: 2, unit: "hours" }] })).reminders).toBeUndefined();
  });

  it("aValidFormHasNoErrors", () => {
    expect(validateEventForm(base())).toEqual({});
  });
});

describe("reminders and warnings", () => {
  it("addReminderButtonDisabledAtTen", () => {
    const nine = Array.from({ length: MAX_REMINDERS - 1 }, (_, i) => ({ amount: i + 1, unit: "hours" as const }));
    expect(canAddReminder(base({ reminders: nine }))).toBe(true);
    expect(canAddReminder(base({ reminders: [...nine, { amount: 10, unit: "hours" }] }))).toBe(false);
  });

  it("monthDay31SkipsShortMonths", () => {
    const monthly = (monthDay: number) => base({ repeat: { ...base().repeat, mode: "monthly", monthlyBy: "day", monthDay } });
    expect(monthDaySkipsMonths(monthly(31))).toBe(true);
    expect(monthDaySkipsMonths(monthly(29))).toBe(true);
    expect(monthDaySkipsMonths(monthly(28))).toBe(false);
    expect(monthDaySkipsMonths(base())).toBe(false);
  });
});

describe("fromEvent", () => {
  const event = (over: Partial<EventDetail> = {}): EventDetail => ({
    id: 1, title: "Music class", notes: "Bring the book", icon: "🎵", color: "violet", display_color: "violet", all_day: false, start_date: "2026-11-07",
    start_time: "09:00", duration_minutes: 90,
    recurrence: { freq: "monthly", interval: 1, weekdays: [], month_day: null, nth_weekdays: [{ nth: 1, day: "SAT" }, { nth: 3, day: "SAT" }] },
    ends_on: "2027-06-30", max_count: null, people: [7], reminders: [{ amount: 1, unit: "days" }],
    created_by: 1, updated_by: 1, exceptions: [], ...over,
  });

  it("anEventWithAMondayToFridayRuleOpensAsEveryWeekday", () => {
    const recurrence = { freq: "weekly" as const, interval: 1, weekdays: ["MON" as const, "TUE" as const, "WED" as const, "THU" as const, "FRI" as const], month_day: null, nth_weekdays: [] };
    expect(isEveryWeekday(fromEvent(event({ recurrence })).repeat)).toBe(true);
  });

  it("roundTripsAnEventThroughTheForm", () => {
    const e = event();
    const input = toEventInput(fromEvent(e));
    expect(input).toEqual({
      title: "Music class", notes: "Bring the book", icon: "🎵", color: "violet", all_day: false, start_date: "2026-11-07",
      start_time: "09:00", duration_minutes: 90, people: [7], recurrence: e.recurrence, ends_on: "2027-06-30",
      max_count: null, reminders: [{ amount: 1, unit: "days" }],
    });
  });

  it("aNonRepeatingAllDayEventComesBackAsOne", () => {
    const form = fromEvent(event({ all_day: true, start_time: null, duration_minutes: null, recurrence: null, ends_on: null, notes: null, icon: null, color: null }));
    expect(form.allDay).toBe(true);
    expect(form.repeat.mode).toBe("none");
    expect(toEventInput(form)).toMatchObject({ all_day: true, start_time: null, recurrence: null, notes: null, icon: null, color: null });
  });

  it("aCountedSeriesKeepsItsCount", () => {
    const form = fromEvent(event({ ends_on: null, max_count: 8 }));
    expect([form.repeat.end, form.repeat.count]).toEqual(["after", 8]);
  });
});

describe("diffDays", () => {
  it("countsCalendarDaysAcrossMonthsAndDst", () => {
    expect(diffDays("2026-11-12", "2026-11-19")).toBe(7);
    expect(diffDays("2026-11-19", "2026-11-12")).toBe(-7);
    expect(diffDays("2026-03-07", "2026-03-09")).toBe(2); // across the spring clock change
    expect(diffDays("2026-12-30", "2027-01-02")).toBe(3);
  });
});

describe("an occurrence that was changed with 'this event only'", () => {
  const series = (over: Partial<EventDetail> = {}): EventDetail => ({
    id: 1, title: "Swimming", notes: "Bring a towel", icon: "🏊", color: null, display_color: "teal", all_day: false, start_date: "2026-11-05",
    start_time: "18:00", duration_minutes: 60,
    recurrence: { freq: "weekly", interval: 1, weekdays: ["THU"], month_day: null, nth_weekdays: [] }, ends_on: null,
    max_count: null, people: [], reminders: [], created_by: 1, updated_by: 1, exceptions: [], ...over,
  });
  const moved = { original_date: "2026-11-12", cancelled: false, title: "Early swim", notes: null, start_date: "2026-11-13",
    start_time: "07:00", duration_minutes: 90 };

  it("reopensWithTheChangesItHad", () => {
    const form = fromEvent(series(), "2026-11-13", moved);
    expect([form.title, form.date, form.startTime, form.endTime, form.notes]).toEqual(["Early swim", "2026-11-13", "07:00", "08:30", "Bring a towel"]);
  });

  it("anExceptionThatChangesOnlyTheTitleKeepsTheSeriesTimes", () => {
    const form = fromEvent(series(), "2026-11-12", { ...moved, start_date: null, start_time: null, duration_minutes: null });
    expect([form.title, form.startTime, form.endTime]).toEqual(["Early swim", "18:00", "19:00"]);
  });

  it("aSeriesWithoutAnEndStaysWithoutOneUnlessTheExceptionGivesALength", () => {
    expect(fromEvent(series({ duration_minutes: null }), "2026-11-12", { ...moved, duration_minutes: null }).endTime).toBe("");
    expect(fromEvent(series({ duration_minutes: null }), "2026-11-12", moved).endTime).toBe("08:30");
  });

  it("changingThePeopleOrTheColorIsASeriesChange", () => {
    expect(seriesFieldsChanged(series(), fromEvent(series()))).toBe(false);
    expect(seriesFieldsChanged(series(), { ...fromEvent(series()), people: [2] })).toBe(true);
    expect(seriesFieldsChanged(series(), { ...fromEvent(series()), color: "red" })).toBe(true);
  });

  it("aMovedOccurrenceNeverEndsAfterMidnight", () => {
    expect(fromEvent(series(), "2026-11-12", { ...moved, start_time: "23:30", duration_minutes: 90 }).endTime).toBe("");
  });
});

describe("keeping the date and the repeat rule together", () => {
  const weekly = (weekdays: ("MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN")[]) =>
    base({ date: "2026-11-11", repeat: { ...base().repeat, mode: "weekly", weekdays } }); // 11 November 2026 is a Wednesday

  it("moving_the_date_moves_a_single_weekday_with_it", () => {
    expect(resyncRepeat(weekly(["WED"]).repeat, "2026-11-11", "2026-11-13").weekdays).toEqual(["FRI"]);
  });

  it("aCustomisedWeekdaySelectionIsLeftAlone", () => {
    expect(resyncRepeat(weekly(["TUE", "THU"]).repeat, "2026-11-11", "2026-11-13").weekdays).toEqual(["TUE", "THU"]);
    expect(resyncRepeat(weekly(["MON"]).repeat, "2026-11-11", "2026-11-13").weekdays).toEqual(["MON"]); // it was not the old date's day
  });

  it("monthlyDayAndNthWeekdayFollowTheDate", () => {
    const day = { ...base().repeat, mode: "monthly" as const, monthlyBy: "day" as const, monthDay: 11 };
    expect(resyncRepeat(day, "2026-11-11", "2026-11-20").monthDay).toBe(20);
    const nth = { ...base().repeat, mode: "monthly" as const, monthlyBy: "nth" as const, nth: [{ nth: 2, day: "WED" as const }] };
    expect(resyncRepeat(nth, "2026-11-11", "2026-11-28").nth).toEqual([{ nth: 4, day: "SAT" }]);
  });

  it("dailyAndYearlyRulesNeedNoChange", () => {
    const daily = { ...base().repeat, mode: "daily" as const };
    expect(resyncRepeat(daily, "2026-11-11", "2026-11-13")).toEqual(daily);
  });

  it("dateFitsRuleChecksTheWeekdayTheDayAndTheNthWeekday", () => {
    expect(dateFitsRule(weekly(["WED"]))).toBe(true);
    expect(dateFitsRule(weekly(["THU"]))).toBe(false);
    expect(dateFitsRule(base({ date: "2026-11-11", repeat: { ...base().repeat, mode: "monthly", monthlyBy: "day", monthDay: 11 } }))).toBe(true);
    expect(dateFitsRule(base({ date: "2026-11-11", repeat: { ...base().repeat, mode: "monthly", monthlyBy: "day", monthDay: 12 } }))).toBe(false);
    expect(dateFitsRule(base({ date: "2026-11-11", repeat: { ...base().repeat, mode: "monthly", monthlyBy: "nth", nth: [{ nth: 2, day: "WED" }] } }))).toBe(true);
    expect(dateFitsRule(base({ date: "2026-11-11", repeat: { ...base().repeat, mode: "monthly", monthlyBy: "nth", nth: [{ nth: 3, day: "WED" }] } }))).toBe(false);
    expect(dateFitsRule(base({ date: "2026-11-11" }))).toBe(true); // does not repeat
  });

  it("aNewEventsDateMustBeOneOfItsRepeatDays", () => {
    expect(validateEventForm(weekly(["THU"]), { requireDateInRule: true }).date).toBeDefined();
    expect(validateEventForm(weekly(["THU"])).date).toBeUndefined(); // an existing event is left to the server
    expect(validateEventForm(weekly(["WED"]), { requireDateInRule: true }).date).toBeUndefined();
  });
});

