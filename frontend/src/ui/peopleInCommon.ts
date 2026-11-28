import type { Person } from "./Avatar";

/**
 * The faces Staff may filter by: themself, and the people who share a task or event with them (`itemPeople` is the list of
 * people of each item they can see). A person already picked stays, so the pick can be undone.
 */
export function peopleInCommon(everyone: Person[], itemPeople: number[][], meId: number, picked: number[]): Person[] {
  const keep = new Set<number>([meId, ...picked, ...itemPeople.flat()]);
  return everyone.filter((p) => keep.has(p.id));
}
