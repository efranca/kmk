import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Task } from "../tasks/types";
import { DEFAULT_PREFERENCES } from "../preferences";
import { preferencesWrapper } from "../testUtils";
import { tasksByDate, useShowTasks } from "./taskItems";

let n = 0;
const task = (over: Partial<Task>): Task => {
  n += 1;
  return {
    id: n, title: `T${n}`, description: null, icon: null, category_id: null, people: [], status: "pending", due_date: null, completed_at: null,
    show_on_dashboard: true, created_by: { id: 1, name: "A" }, updated_by: { id: 1, name: "A" }, created_at: "", updated_at: "", ...over,
  };
};

describe("tasksByDate", () => {
  it("keeps only the tasks with a due date inside the range, grouped by day", () => {
    const inside = task({ due_date: "2026-11-12" });
    const alsoInside = task({ due_date: "2026-11-12" });
    const map = tasksByDate([inside, alsoInside, task({ due_date: null }), task({ due_date: "2026-10-31" }), task({ due_date: "2026-12-01" })], "2026-11-01", "2026-11-30", []);
    expect([...map.keys()]).toEqual(["2026-11-12"]);
    expect(map.get("2026-11-12")).toEqual([inside, alsoInside]);
  });

  it("with people picked keeps their tasks and the whole team's, like events for everyone", () => {
    const mine = task({ due_date: "2026-11-12", people: [2] });
    const team = task({ due_date: "2026-11-12", people: [] });
    const other = task({ due_date: "2026-11-12", people: [3] });
    expect(tasksByDate([mine, team, other], "2026-11-01", "2026-11-30", [2]).get("2026-11-12")).toEqual([mine, team]);
  });
});

describe("useShowTasks", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("starts off and follows the preference", () => {
    const { result } = renderHook(() => useShowTasks(), { wrapper: preferencesWrapper() });
    expect(result.current[0]).toBe(false);
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
  });

  it("starts on when the account says so", () => {
    const wrapper = preferencesWrapper({ ...DEFAULT_PREFERENCES, show_tasks_on_schedule: true });
    expect(renderHook(() => useShowTasks(), { wrapper }).result.current[0]).toBe(true);
  });
});
