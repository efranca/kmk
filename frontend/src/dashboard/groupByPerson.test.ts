import { describe, expect, it } from "vitest";

import { occurrence, person } from "../testUtils";
import { groupByPerson } from "./groupByPerson";

const ana = person(1, "Ana Lima");
const bob = person(2, "Bob Roy");
const cleo = person(3, "Cléo Gagnon");
const people = [cleo, bob, ana]; // deliberately not in name order

describe("groupByPerson", () => {
  it("puts an event under each listed person", () => {
    const shared = occurrence({ title: "Deep clean", people: [1, 2] });
    const { byPerson } = groupByPerson([shared], people);
    expect(byPerson.map((g) => g.person.name)).toEqual(["Ana Lima", "Bob Roy"]);
    expect(byPerson.every((g) => g.occurrences[0] === shared)).toBe(true);
  });

  it("puts events for everyone in their own group, not under each person", () => {
    const all = occurrence({ title: "Team meeting", people: [] });
    const mine = occurrence({ title: "Visit", people: [3] });
    const { everyone, byPerson } = groupByPerson([all, mine], people);
    expect(everyone).toEqual([all]);
    expect(byPerson).toHaveLength(1);
    expect(byPerson[0]!.person.name).toBe("Cléo Gagnon");
  });

  it("omits people without events", () => {
    const { byPerson } = groupByPerson([occurrence({ people: [2] })], people);
    expect(byPerson.map((g) => g.person.id)).toEqual([2]);
  });

  it("orders groups by name and each group's events by date, all-day first, then time", () => {
    const late = occurrence({ title: "Late", people: [1], date: "2026-11-12", start_time: "15:00" });
    const early = occurrence({ title: "Early", people: [1], date: "2026-11-12", start_time: "08:00" });
    const allDay = occurrence({ title: "Holiday", people: [1], date: "2026-11-12", all_day: true, start_time: null, end_time: null });
    const nextDay = occurrence({ title: "Next", people: [1], date: "2026-11-13", start_time: "07:00" });
    const { byPerson } = groupByPerson([nextDay, late, early, allDay], people);
    expect(byPerson[0]!.occurrences.map((o) => o.title)).toEqual(["Holiday", "Early", "Late", "Next"]);
  });

  it("ignores listed people it does not know (a disabled account)", () => {
    const { byPerson, everyone } = groupByPerson([occurrence({ people: [99] })], people);
    expect(byPerson).toEqual([]);
    expect(everyone).toEqual([]);
  });
});
