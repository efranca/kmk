/** The narrowest a bottom-bar tab may get before the rest move behind "More". */
export const MIN_TAB_PX = 64;

/**
 * Which items stay in the bar and which go to the "More" sheet. When they do not all fit, one slot is kept for the
 * "More" button itself. An unknown width (0, as in jsdom or before the first measure) never hides anything.
 */
export function fitTabs<T>(items: T[], barWidth: number, minTab = MIN_TAB_PX): { shown: T[]; more: T[] } {
  if (barWidth <= 0 || items.length * minTab <= barWidth) return { shown: items, more: [] };
  const slots = Math.max(2, Math.floor(barWidth / minTab));
  return { shown: items.slice(0, slots - 1), more: items.slice(slots - 1) };
}
