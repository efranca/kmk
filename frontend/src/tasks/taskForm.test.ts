import { describe, expect, it } from "vitest";

import { emptyTaskForm, formToInput, taskToForm, validateTaskForm } from "./taskForm";
import type { Task } from "./types";

const task: Task = {
  id: 1, title: "Mop", description: "Blue bucket", icon: "🧹", category_id: 3, people: [2, 5], status: "pending", due_date: "2026-11-30",
  completed_at: null, show_on_dashboard: false, created_by: { id: 1, name: "A" }, updated_by: { id: 1, name: "A" }, created_at: "", updated_at: "",
};

describe("taskForm", () => {
  it("round trips a task through the form", () => {
    expect(formToInput(taskToForm(task))).toEqual({
      title: "Mop", description: "Blue bucket", icon: "🧹", category_id: 3, people: [2, 5], due_date: "2026-11-30", show_on_dashboard: false,
    });
  });

  it("turns empty optional fields into null and trims", () => {
    const input = formToInput({ ...emptyTaskForm([4]), title: "  Wash  ", description: "   " });
    expect(input).toEqual({ title: "Wash", description: null, icon: null, category_id: null, people: [4], due_date: null, show_on_dashboard: true });
  });

  it("flags a blank or too long title", () => {
    expect(validateTaskForm({ ...emptyTaskForm(), title: "  " }).title).toBe("taskErrTitle");
    expect(validateTaskForm({ ...emptyTaskForm(), title: "x".repeat(201) }).title).toBe("taskErrTitle");
    expect(validateTaskForm({ ...emptyTaskForm(), title: "ok" })).toEqual({});
  });

  it("flags a description over 2000 characters", () => {
    expect(validateTaskForm({ ...emptyTaskForm(), title: "ok", description: "x".repeat(2001) }).description).toBe("taskErrDescription");
  });
});
