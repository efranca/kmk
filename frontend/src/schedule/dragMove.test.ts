import { moveSlot, resizeSlot, sameSlot, snap, timeOfMinutes } from "./dragMove";

const slot = { date: "2026-11-12", startMin: 9 * 60, endMin: 10 * 60 + 30 };

describe("snap", () => {
  it("rounds to the quarter hour", () => {
    expect(snap(0)).toBe(0);
    expect(snap(7)).toBe(0);
    expect(snap(8)).toBe(15);
    expect(snap(9 * 60 + 22)).toBe(9 * 60 + 15);
    expect(snap(9 * 60 + 23)).toBe(9 * 60 + 30);
  });
});

describe("moveSlot", () => {
  it("moves the start and keeps the duration", () => {
    expect(moveSlot(slot, 60, "2026-11-12")).toEqual({ date: "2026-11-12", startMin: 10 * 60, endMin: 11 * 60 + 30 });
    expect(moveSlot(slot, -45, "2026-11-12")).toEqual({ date: "2026-11-12", startMin: 8 * 60 + 15, endMin: 9 * 60 + 45 });
  });
  it("can land on another day", () => {
    expect(moveSlot(slot, 0, "2026-11-14").date).toBe("2026-11-14");
  });
  it("snaps the start to a quarter of an hour", () => {
    expect(moveSlot(slot, 22, "2026-11-12").startMin).toBe(9 * 60 + 15);
  });
  it("stays inside the day, whatever the drag", () => {
    expect(moveSlot(slot, -9999, "2026-11-12")).toEqual({ date: "2026-11-12", startMin: 0, endMin: 90 });
    expect(moveSlot(slot, 9999, "2026-11-12")).toEqual({ date: "2026-11-12", startMin: 24 * 60 - 90, endMin: 24 * 60 });
  });
});

describe("resizeSlot", () => {
  it("moves the end and keeps the start", () => {
    expect(resizeSlot(slot, 30)).toEqual({ ...slot, endMin: 11 * 60 });
    expect(resizeSlot(slot, -30)).toEqual({ ...slot, endMin: 10 * 60 });
  });
  it("is never shorter than one step, and never past midnight", () => {
    expect(resizeSlot(slot, -9999).endMin).toBe(9 * 60 + 15);
    expect(resizeSlot(slot, 9999).endMin).toBe(24 * 60);
  });
});

describe("helpers", () => {
  it("compares slots", () => {
    expect(sameSlot(slot, { ...slot })).toBe(true);
    expect(sameSlot(slot, { ...slot, endMin: slot.endMin + 15 })).toBe(false);
  });
  it("writes a minute of the day as HH:mm", () => {
    expect(timeOfMinutes(9 * 60 + 5)).toBe("09:05");
    expect(timeOfMinutes(24 * 60)).toBe("23:59");
  });
});
