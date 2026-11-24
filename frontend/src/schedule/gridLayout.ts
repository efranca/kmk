// Pure layout for the Day and Week time grid: how tall each hour is, where an event goes, and how overlapping events
// share a column. Hours with nothing in them are compacted so the busy ones get the room; every hour stays visible.
import { isWeekend } from "./scheduleDates";

export interface HourWindow { start: number; end: number }

/** The hours the Day and Week grids give most of their room to: weekdays 07:00-20:00, weekends 08:00-20:00. */
export const WEEKDAY_HOURS: HourWindow = { start: 7, end: 20 };
export const WEEKEND_HOURS: HourWindow = { start: 8, end: 20 };

/** A stretch of the day. {@code weight} is its share of the grid's height; a compressed band is empty and thin. */
export interface Band { from: number; to: number; weight: number; compressed: boolean }

/** How much of its natural height an hour keeps when nothing is happening in it on any day shown. */
export const EMPTY_WEIGHT_PER_HOUR = 0.5;

/** The hours (0 to 23) that something covers: an event from 09:30 to 10:15 covers 9 and 10. */
export function busyHours(spans: { startMin: number; endMin: number }[]): Set<number> {
  const busy = new Set<number>();
  for (const { startMin, endMin } of spans) {
    for (let h = Math.floor(startMin / 60); h < Math.ceil(Math.max(endMin, startMin + 1) / 60) && h < 24; h++) busy.add(h);
  }
  return busy;
}

/**
 * The whole day (hours 0 to 24) as bands of runs of hours: hours with something in them keep their full height and runs
 * of empty hours are compacted, which gives the room to the hours that are in use. Every hour stays in the grid.
 */
export function hourBands(busy: ReadonlySet<number>): Band[] {
  const bands: Band[] = [];
  for (let h = 0; h < 24; h++) {
    const compressed = !busy.has(h);
    const last = bands[bands.length - 1];
    if (last && last.compressed === compressed) { last.to = h + 1; last.weight += compressed ? EMPTY_WEIGHT_PER_HOUR : 1; }
    else bands.push({ from: h, to: h + 1, weight: compressed ? EMPTY_WEIGHT_PER_HOUR : 1, compressed });
  }
  return bands;
}

const totalWeight = (bands: Band[]) => bands.reduce((sum, b) => sum + b.weight, 0);

/** Where a minute of the day sits, from 0 (top) to 1 (bottom); out of range minutes are clamped. */
export function positionOf(bands: Band[], minutes: number): number {
  const hour = Math.min(24, Math.max(0, minutes / 60));
  const total = totalWeight(bands);
  let before = 0;
  for (const band of bands) {
    if (hour <= band.to) return (before + ((hour - band.from) / (band.to - band.from)) * band.weight) / total;
    before += band.weight;
  }
  return 1;
}

/** The minute of the day at a position from 0 to 1: the inverse of {@link positionOf}. */
export function minutesAt(bands: Band[], fraction: number): number {
  const total = totalWeight(bands);
  const target = Math.min(1, Math.max(0, fraction)) * total;
  let before = 0;
  for (const band of bands) {
    if (target <= before + band.weight) return (band.from + ((target - before) / band.weight) * (band.to - band.from)) * 60;
    before += band.weight;
  }
  return 24 * 60;
}

export const toMinutes = (time: string): number => {
  const [h, m] = time.split(":").map(Number) as [number, number];
  return h * 60 + m;
};

export interface GridItem { key: string; startMin: number; endMin: number }
export interface Placed<T extends GridItem> { item: T; col: number; cols: number }

/**
 * Side-by-side columns for the items of one day: an item takes the first column that is free at its start, and every
 * item of a group of overlapping ones shares the group's column count. Items that only touch do not overlap.
 */
export function layoutColumn<T extends GridItem>(items: T[]): Placed<T>[] {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const out: Placed<T>[] = [];
  let cluster: Placed<T>[] = [];
  let columnEnds: number[] = [];
  let clusterEnd = -1;
  const close = () => {
    for (const placed of cluster) placed.cols = columnEnds.length;
    out.push(...cluster);
    cluster = [];
    columnEnds = [];
  };
  for (const item of sorted) {
    if (cluster.length > 0 && item.startMin >= clusterEnd) close();
    let col = columnEnds.findIndex((end) => end <= item.startMin);
    if (col === -1) col = columnEnds.length;
    columnEnds[col] = item.endMin;
    cluster.push({ item, col, cols: 1 });
    clusterEnd = Math.max(clusterEnd, item.endMin);
  }
  close();
  return out;
}

/** The emphasised hours on that day: weekends have their own window. */
export function windowFor(date: string): HourWindow {
  return isWeekend(date) ? { ...WEEKEND_HOURS } : { ...WEEKDAY_HOURS };
}

/** One window that covers every day shown, so the columns of a week line up. */
export function unionWindow(days: string[]): HourWindow {
  const windows = days.map((d) => windowFor(d));
  return { start: Math.min(...windows.map((w) => w.start)), end: Math.max(...windows.map((w) => w.end)) };
}
