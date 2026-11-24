import i18n from "../i18n";
import type { RecurrenceRule } from "./types";
import {
  addDays, addMonths, describeRepeat, firstDayOf, isWeekend, monthGrid, todayIn, weekStart,
} from "./scheduleDates";

const en = i18n.getFixedT("en");
const rule = (over: Partial<RecurrenceRule>): RecurrenceRule => ({
  freq: "weekly", interval: 1, weekdays: [], month_day: null, nth_weekdays: [], ...over,
});

describe("dates", () => {
  it("weekStartMondayAndSunday", () => {
    expect(weekStart("2026-11-12", 1)).toBe("2026-11-09"); // Thursday -> Monday
    expect(weekStart("2026-11-12", 0)).toBe("2026-11-08"); // Thursday -> Sunday
    expect(weekStart("2026-11-09", 1)).toBe("2026-11-09"); // already the first day
    expect(weekStart("2026-11-08", 1)).toBe("2026-11-02"); // a Sunday belongs to the week before
  });

  it("monthGridHasSixWeeksStartingOnWeekStart", () => {
    const grid = monthGrid(2026, 11, 1);
    expect(grid).toHaveLength(42);
    expect(grid[0]).toBe("2026-10-26"); // 1 Nov 2026 is a Sunday: the Monday grid starts the week before
    expect(grid[6]).toBe("2026-11-01");
    expect(grid[41]).toBe("2026-12-06");
    expect(monthGrid(2026, 11, 0)[0]).toBe("2026-11-01");
  });

  it("addDaysCrossesMonthAndYear", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-11-01", 0)).toBe("2026-11-01");
    expect(addDays("2026-03-07", 1)).toBe("2026-03-08"); // across a daylight-saving change
  });

  it("addMonthsClampsTheDayToTheShorterMonth", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2026-11-12", 12)).toBe("2027-11-12");
  });

  it("isWeekendSaturdaySunday", () => {
    expect(isWeekend("2026-11-07")).toBe(true);
    expect(isWeekend("2026-11-08")).toBe(true);
    expect(isWeekend("2026-11-09")).toBe(false);
  });

  it("firstDayOfUsesSundayForEnglishAndMondayElsewhere", () => {
    expect(firstDayOf("en")).toBe(0);
    expect(firstDayOf("pt-BR")).toBe(1);
    expect(firstDayOf("fr-CA")).toBe(1);
  });

  it("todayInUsesTheGivenTimeZone", () => {
    const moment = new Date("2026-11-08T02:30:00Z"); // still Saturday evening in Toronto
    expect(todayIn("America/Toronto", moment)).toBe("2026-11-07");
    expect(todayIn("UTC", moment)).toBe("2026-11-08");
    expect(todayIn("Asia/Tokyo", moment)).toBe("2026-11-08");
  });
});

describe("describeRepeat", () => {
  const locale = "en-US";

  it("describeRepeatWeeklyThursday", () => {
    expect(describeRepeat(rule({ weekdays: ["THU"] }), en, locale)).toBe("Every Thursday");
  });

  it("describeRepeatEveryWeekday", () => {
    expect(describeRepeat(rule({ weekdays: ["MON", "TUE", "WED", "THU", "FRI"] }), en, locale)).toBe("Every weekday");
    expect(describeRepeat(rule({ weekdays: ["MON", "TUE", "WED", "THU", "FRI", "SAT"] }), en, locale)).toContain("Saturday");
    expect(describeRepeat(rule({ interval: 2, weekdays: ["MON", "TUE", "WED", "THU", "FRI"] }), en, locale)).toContain("2 weeks");
  });

  it("describeRepeatTwiceAWeek", () => {
    expect(describeRepeat(rule({ weekdays: ["TUE", "THU"] }), en, locale)).toBe("Every Tuesday and Thursday");
  });

  it("describeRepeatFourthSaturday", () => {
    expect(describeRepeat(rule({ freq: "monthly", nth_weekdays: [{ nth: 4, day: "SAT" }] }), en, locale))
      .toBe("Every month on the 4th Saturday");
  });

  it("describeRepeatFirstAndThirdSaturday", () => {
    expect(describeRepeat(rule({ freq: "monthly", nth_weekdays: [{ nth: 1, day: "SAT" }, { nth: 3, day: "SAT" }] }), en, locale))
      .toBe("Every month on the 1st and 3rd Saturday");
  });

  it("describeRepeatEveryTwoWeeksOnMondayAndWednesday", () => {
    expect(describeRepeat(rule({ interval: 2, weekdays: ["MON", "WED"] }), en, locale))
      .toBe("Every 2 weeks on Monday and Wednesday");
  });

  it("describeRepeatDailyMonthlyDayAndYearly", () => {
    expect(describeRepeat(rule({ freq: "daily" }), en, locale)).toBe("Every day");
    expect(describeRepeat(rule({ freq: "daily", interval: 3 }), en, locale)).toBe("Every 3 days");
    expect(describeRepeat(rule({ freq: "monthly", month_day: 15 }), en, locale)).toBe("Every month on day 15");
    expect(describeRepeat(rule({ freq: "monthly", interval: 2, month_day: 31 }), en, locale)).toBe("Every 2 months on day 31");
    expect(describeRepeat(rule({ freq: "yearly" }), en, locale)).toBe("Every year");
  });

  it("describeRepeatSpeaksPortugueseAndFrench", () => {
    const pt = i18n.getFixedT("pt-BR");
    const fr = i18n.getFixedT("fr-CA");
    const first3 = rule({ freq: "monthly", nth_weekdays: [{ nth: 1, day: "SAT" }, { nth: 3, day: "SAT" }] });
    expect(describeRepeat(first3, pt, "pt-BR")).toBe("Todo mês, 1º e 3º sábado");
    expect(describeRepeat(rule({ freq: "monthly", nth_weekdays: [{ nth: 2, day: "THU" }] }), pt, "pt-BR")).toContain("2ª");
    expect(describeRepeat(first3, fr, "fr-CA")).toBe("Chaque mois, le 1er et 3e samedi");
    expect(describeRepeat(rule({ weekdays: ["THU"] }), fr, "fr-CA")).toBe("Chaque jeudi");
  });
});
