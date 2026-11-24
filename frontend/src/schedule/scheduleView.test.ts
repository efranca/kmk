import { shiftDate, visibleRange } from "./scheduleView";

describe("the week view on a phone shows three days", () => {
  it("visibleRangeIsThreeDaysFromTheDateWhenNarrow", () => {
    expect(visibleRange("week", "2026-11-14", 0, true)).toEqual(["2026-11-14", "2026-11-16"]);
    expect(visibleRange("week", "2026-11-14", 0, false)).toEqual(["2026-11-08", "2026-11-14"]);
  });

  it("stepsByThreeDaysWhenNarrowSoNoDayIsSkipped", () => {
    expect(shiftDate("week", "2026-11-11", 1, true)).toBe("2026-11-14");
    expect(shiftDate("week", "2026-11-11", -1, true)).toBe("2026-11-08");
    expect(shiftDate("week", "2026-11-11", 1, false)).toBe("2026-11-18");
  });

  it("otherViewsIgnoreNarrow", () => {
    expect(shiftDate("day", "2026-11-11", 1, true)).toBe("2026-11-12");
    expect(shiftDate("month", "2026-11-11", 1, true)).toBe("2026-12-11");
    expect(visibleRange("day", "2026-11-11", 0, true)).toEqual(["2026-11-11", "2026-11-11"]);
  });
});
