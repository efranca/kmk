import { describe, expect, it } from "vitest";

import type { Task } from "../tasks/types";
import { myTaskSections } from "./myTasks";

let n = 0;
const task = (over: Partial<Task>): Task => {
  n += 1;
  return {
    id: n, title: `T${n}`, description: null, icon: null, category_id: null, people: [], status: "pending", due_date: null, completed_at: null,
    show_on_dashboard: true, created_by: { id: 9, name: "Z" }, updated_by: { id: 9, name: "Z" }, created_at: "", updated_at: "", ...over,
  };
};
const ids = (list: Task[]) => list.map((x) => x.id);
const today = "2026-11-24";
const tomorrow = "2026-11-25";

describe("myTaskSections", () => {
  it("keeps only my tasks and the whole team's, and leaves out the ones hidden from the Dashboard", () => {
    const mine = task({ people: [1] });
    const team = task({ people: [] });
    const other = task({ people: [2] });
    const hidden = task({ people: [1], show_on_dashboard: false });
    const s = myTaskSections([mine, team, other, hidden], 1, today, tomorrow);
    expect(ids(s.noDate)).toEqual([mine.id, team.id]);
  });

  it("splits by due date", () => {
    const late = task({ due_date: "2026-11-20" });
    const now = task({ due_date: today });
    const next = task({ due_date: tomorrow });
    const later = task({ due_date: "2026-12-30" });
    const s = myTaskSections([late, now, next, later], 1, today, tomorrow);
    expect([ids(s.overdue), ids(s.today), ids(s.tomorrow)]).toEqual([[late.id], [now.id], [next.id]]);
    expect(s.noDate).toEqual([]); // a later date is not "no date": it waits for its own day
  });

  it("a task finished today uses the Toronto day, not the UTC one", () => {
    // 21:30 in Toronto on the 24th is 02:30 UTC on the 25th
    const late = task({ status: "completed", completed_at: "2026-11-25T02:30:00Z", due_date: "2026-11-20" });
    const yesterday = task({ status: "completed", completed_at: "2026-11-24T04:30:00Z" }); // 23:30 on the 23rd in Toronto
    const dueToday = task({ status: "completed", completed_at: "2026-11-10T15:00:00Z", due_date: today });
    const s = myTaskSections([late, yesterday, dueToday], 1, today, tomorrow);
    expect(ids(s.doneToday)).toEqual([late.id, dueToday.id]);
  });

  it("keeps in-progress tasks in the open sections", () => {
    const active = task({ status: "in_progress", due_date: today });
    const late = task({ status: "in_progress", due_date: "2026-11-20" });
    const s = myTaskSections([active, late], 1, today, tomorrow);
    expect(ids(s.today)).toEqual([active.id]);
    expect(ids(s.overdue)).toEqual([late.id]);
  });
});
