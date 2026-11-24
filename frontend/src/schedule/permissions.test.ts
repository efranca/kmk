import { describe, expect, it } from "vitest";

import { canChangeEvent } from "./permissions";

const event = (created_by: number, people: number[]) => ({ created_by, people });
const user = (id: number, role: "user" | "admin" | "superadmin" = "user") => ({ id, role });

describe("canChangeEvent (the server stays the authority)", () => {
  it("the creator may change it", () => expect(canChangeEvent(user(1), event(1, [2]))).toBe(true));
  it("a listed person may change it", () => expect(canChangeEvent(user(2), event(1, [2, 3]))).toBe(true));
  it("an unlisted plain user may not", () => expect(canChangeEvent(user(4), event(1, [2, 3]))).toBe(false));
  it("an admin or the super admin may change anything", () => {
    expect(canChangeEvent(user(9, "admin"), event(1, [2]))).toBe(true);
    expect(canChangeEvent(user(9, "superadmin"), event(1, []))).toBe(true);
  });
  it("an event for everyone: only its creator or an admin", () => {
    expect(canChangeEvent(user(1), event(1, []))).toBe(true);
    expect(canChangeEvent(user(2), event(1, []))).toBe(false);
  });
});
