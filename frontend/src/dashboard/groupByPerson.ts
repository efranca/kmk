import type { Occurrence } from "../schedule/types";
import type { Person } from "../ui/Avatar";

export interface PersonGroup {
  person: Person;
  occurrences: Occurrence[];
}

/** Date, then all-day first, then start time. */
const byWhen = (a: Occurrence, b: Occurrence) =>
  a.date.localeCompare(b.date) || Number(!a.all_day) - Number(!b.all_day) || (a.start_time ?? "").localeCompare(b.start_time ?? "");

/**
 * Occurrences grouped for the "All events" card: the ones for everyone in their own list (not repeated under every
 * person), then one group per person who has something (an event for several people appears under each). People
 * ordered by name, each group's events by when. People the list does not know (a disabled account) are left out.
 */
export function groupByPerson(occurrences: Occurrence[], people: Person[]): { everyone: Occurrence[]; byPerson: PersonGroup[] } {
  const everyone = occurrences.filter((o) => o.people.length === 0).sort(byWhen);
  const byPerson = [...people]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((person) => ({ person, occurrences: occurrences.filter((o) => o.people.includes(person.id)).sort(byWhen) }))
    .filter((group) => group.occurrences.length > 0);
  return { everyone, byPerson };
}
