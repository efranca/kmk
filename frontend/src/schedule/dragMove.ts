// Moving and resizing an event in the Day/Week grid: minutes snap to a quarter of an hour, a move keeps the duration and
// stays inside the day, a resize keeps the start and the event at least one step long. Pure: the grid does the pointers.

/** The step events snap to, in minutes. */
export const SNAP_MINUTES = 15;
const DAY = 24 * 60;

export interface Slot { date: string; startMin: number; endMin: number }

export const snap = (minutes: number): number => Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** `original` moved by `deltaMin` (and onto `date`): same duration, start snapped, never leaving the day. */
export function moveSlot(original: Slot, deltaMin: number, date: string): Slot {
  const length = original.endMin - original.startMin;
  const startMin = clamp(snap(original.startMin + deltaMin), 0, Math.max(0, DAY - length));
  return { date, startMin, endMin: startMin + length };
}

/** `original` with its end moved by `deltaMin`: at least one step long, and not past midnight. */
export function resizeSlot(original: Slot, deltaMin: number): Slot {
  const endMin = clamp(snap(original.endMin + deltaMin), original.startMin + SNAP_MINUTES, DAY);
  return { ...original, endMin };
}

export const sameSlot = (a: Slot, b: Slot): boolean => a.date === b.date && a.startMin === b.startMin && a.endMin === b.endMin;

/** "HH:mm" for a minute of the day (midnight at the end of the day is "23:59", as the form can't hold 24:00). */
export function timeOfMinutes(minutes: number): string {
  const m = Math.min(minutes, DAY - 1);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
