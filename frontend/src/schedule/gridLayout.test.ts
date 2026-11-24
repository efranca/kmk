import {
  busyHours, EMPTY_WEIGHT_PER_HOUR, hourBands, layoutColumn, minutesAt, positionOf, toMinutes, unionWindow, windowFor, type GridItem,
} from "./gridLayout";


describe("busyHours", () => {
  it("coversEveryHourAnEventTouches", () => {
    expect([...busyHours([{ startMin: 9 * 60 + 30, endMin: 10 * 60 + 15 }])]).toEqual([9, 10]);
    expect([...busyHours([{ startMin: 9 * 60, endMin: 10 * 60 }])]).toEqual([9]); // ends on the hour: 10 is free
    expect(busyHours([{ startMin: 23 * 60, endMin: 24 * 60 + 90 }]).has(24)).toBe(false);
  });
});

describe("hourBands", () => {
  const busy = new Set([9, 10, 15]);

  it("coversTheWholeDayWithoutGaps", () => {
    const bands = hourBands(busy);
    expect(bands[0]!.from).toBe(0);
    expect(bands.at(-1)!.to).toBe(24);
    bands.forEach((b, i) => { if (i > 0) expect(b.from).toBe(bands[i - 1]!.to); });
  });

  it("emptyRunsAreCompactedAndBusyHoursKeepFullHeight", () => {
    const bands = hourBands(busy);
    expect(bands.map((b) => [b.from, b.to, b.compressed])).toEqual([
      [0, 9, true], [9, 11, false], [11, 15, true], [15, 16, false], [16, 24, true],
    ]);
    expect(bands.find((b) => b.from === 9)!.weight).toBe(2);
    expect(bands.find((b) => b.from === 0)!.weight).toBe(9 * EMPTY_WEIGHT_PER_HOUR);
  });

  it("aBusyHourIsTallerThanAnEmptyOne", () => {
    const bands = hourBands(busy);
    const height = (h: number) => positionOf(bands, (h + 1) * 60) - positionOf(bands, h * 60);
    expect(height(9)).toBeGreaterThan(height(12));
  });

  it("aDayWithNothingIsOneCompactedBand", () => {
    expect(hourBands(new Set())).toEqual([{ from: 0, to: 24, weight: 24 * EMPTY_WEIGHT_PER_HOUR, compressed: true }]);
  });

  it("positionIsClampedAndMonotonic", () => {
    const bands = hourBands(busy);
    expect(positionOf(bands, -30)).toBe(0);
    expect(positionOf(bands, 24 * 60)).toBe(1);
    expect(positionOf(bands, 24 * 60 + 90)).toBe(1);
    let last = -1;
    for (let m = 0; m <= 24 * 60; m += 15) {
      const p = positionOf(bands, m);
      expect(p).toBeGreaterThanOrEqual(last);
      last = p;
    }
  });

  it("minutesAtIsTheInverseOfPositionOf", () => {
    const bands = hourBands(busy);
    for (const m of [0, 6 * 60, 9 * 60, 12 * 60 + 30, 15 * 60 + 45, 23 * 60]) {
      expect(minutesAt(bands, positionOf(bands, m))).toBeCloseTo(m, 3);
    }
  });
});

describe("layoutColumn", () => {
  const item = (key: string, from: string, to: string): GridItem => ({ key, startMin: toMinutes(from), endMin: toMinutes(to) });

  it("overlappingEventsSitSideBySide", () => {
    const placed = layoutColumn([item("a", "09:00", "10:00"), item("b", "09:30", "10:30"), item("c", "11:00", "12:00")]);
    const byKey = Object.fromEntries(placed.map((p) => [p.item.key, p]));
    expect([byKey.a!.col, byKey.a!.cols]).toEqual([0, 2]);
    expect([byKey.b!.col, byKey.b!.cols]).toEqual([1, 2]);
    expect([byKey.c!.col, byKey.c!.cols]).toEqual([0, 1]);
  });

  it("aThirdOverlapOpensAThirdColumnAndFreedColumnsAreReused", () => {
    const placed = layoutColumn([
      item("a", "09:00", "11:00"), item("b", "09:30", "10:00"), item("c", "09:45", "10:30"), item("d", "10:30", "11:30"),
    ]);
    const byKey = Object.fromEntries(placed.map((p) => [p.item.key, p]));
    expect(byKey.a!.cols).toBe(3);
    expect(byKey.c!.col).toBe(2);
    expect(byKey.d!.col).toBe(1); // b ended at 10:00, so its column is free again
  });

  it("touchingEventsDoNotOverlap", () => {
    const placed = layoutColumn([item("a", "09:00", "10:00"), item("b", "10:00", "11:00")]);
    expect(placed.map((p) => p.cols)).toEqual([1, 1]);
  });
});

describe("windows", () => {
  it("windowForSaturdayUsesWeekendWindow", () => {
    expect(windowFor("2026-11-07")).toEqual({ start: 8, end: 20 }); // Saturday
    expect(windowFor("2026-11-08")).toEqual({ start: 8, end: 20 }); // Sunday
    expect(windowFor("2026-11-09")).toEqual({ start: 7, end: 20 }); // Monday
  });

  it("unionWindowCoversEveryDayShown", () => {
    expect(unionWindow(["2026-11-07", "2026-11-08"])).toEqual({ start: 8, end: 20 });
    expect(unionWindow(["2026-11-06", "2026-11-07"])).toEqual({ start: 7, end: 20 });
  });
});
