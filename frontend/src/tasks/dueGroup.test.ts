import { describe, expect, it } from "vitest";

import { dueGroup } from "./dueGroup";

describe("dueGroup", () => {
  const today = "2026-11-24";
  it.each([
    ["2026-11-23", "overdue"],
    ["2026-11-24", "today"],
    ["2026-11-25", "week"],
    ["2026-12-01", "week"],
    ["2026-12-02", "later"],
  ])("%s is %s", (due, group) => expect(dueGroup(due, today)).toBe(group));

  it("works across a month and a year boundary", () => {
    expect(dueGroup("2027-01-03", "2026-12-30")).toBe("week");
    expect(dueGroup("2027-01-07", "2026-12-30")).toBe("later");
  });
});
