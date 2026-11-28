import { describe, expect, it } from "vitest";

import { peopleInCommon } from "./peopleInCommon";

const everyone = [1, 2, 3, 4].map((id) => ({ id, name: `P${id}`, color: "teal" as const }));

describe("peopleInCommon", () => {
  it("keeps the person themself and the people who share an item with them", () => {
    expect(peopleInCommon(everyone, [[1, 2], [2], [4]], 1, []).map((p) => p.id)).toEqual([1, 2, 4]);
  });
  it("always keeps themself, even with nothing in common", () => {
    expect(peopleInCommon(everyone, [], 1, []).map((p) => p.id)).toEqual([1]);
  });
  it("keeps a person already picked so the pick can be undone", () => {
    expect(peopleInCommon(everyone, [[2]], 1, [3]).map((p) => p.id)).toEqual([1, 2, 3]);
  });
});
