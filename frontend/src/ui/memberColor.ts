/** The 8 colors of events and of people's faces, in the order the API uses (backend `PALETTE`). */
export const EVENT_COLORS = ["red", "orange", "amber", "green", "teal", "blue", "violet", "pink"] as const;
export type EventColor = (typeof EVENT_COLORS)[number];

/** A person's face color: stable for a user id (the same rule as the API's `/people` colors). */
export function memberColor(userId: number): EventColor {
  return EVENT_COLORS[((userId % EVENT_COLORS.length) + EVENT_COLORS.length) % EVENT_COLORS.length]!;
}

/** The CSS variable holding a color (defined for light and dark in ui.css). */
export const eventColorVar = (color: EventColor): string => `var(--ev-${color})`;

/** The letters shown in a face: first and last word's initials, or one letter for a single word. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letters = words.length > 1 ? [words[0]![0], words[words.length - 1]![0]] : [[...words[0]!][0]];
  return letters.join("").toUpperCase();
}
