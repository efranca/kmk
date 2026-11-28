import { describe, expect, it } from "vitest";

import { canChangeTask, canManageCategories, canSetTaskStatus } from "./permissions";

const task = (creator: number, people: number[]) => ({ created_by: { id: creator, name: "x" }, people });
const user = (id: number, role: "user" | "admin" | "superadmin" = "user") => ({ id, role });

describe("task permissions (mirror of the server's policy)", () => {
  it.each([
    [user(1), task(1, [2]), true, true], // creator
    [user(2), task(1, [2]), true, true], // listed
    [user(3), task(1, [2]), false, false], // unlisted
    [user(3), task(1, []), false, false], // on no one's list and not the creator: neither
    [user(1), task(1, []), true, true],
    [user(9, "admin"), task(1, [2]), true, true],
    [user(9, "superadmin"), task(1, []), true, true],
  ])("%j on %j: edit %s, tick %s", (u, t, edit, tick) => {
    expect(canChangeTask(u, t)).toBe(edit);
    expect(canSetTaskStatus(u, t)).toBe(tick);
  });

  it("follows the server's `editable` flag: an administrator's task can be moved and completed but not edited", () => {
    const madeByAdmin = { ...task(9, [2]), editable: false };
    expect(canChangeTask(user(2), madeByAdmin)).toBe(false);
    expect(canSetTaskStatus(user(2), madeByAdmin)).toBe(true);
  });

  it("only admins manage categories", () => {
    expect(canManageCategories(user(1))).toBe(false);
    expect(canManageCategories(user(1, "admin"))).toBe(true);
    expect(canManageCategories(user(1, "superadmin"))).toBe(true);
  });
});
