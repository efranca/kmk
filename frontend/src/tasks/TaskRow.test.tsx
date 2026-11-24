import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { person } from "../testUtils";
import { TaskRow } from "./TaskRow";
import type { Task } from "./types";

const base: Task = {
  id: 1, title: "Mop the floor", description: null, icon: "🧹", category_id: 1, people: [], status: "pending", due_date: "2026-11-30",
  completed_at: null, show_on_dashboard: true, created_by: { id: 1, name: "A" }, updated_by: { id: 1, name: "A" }, created_at: "", updated_at: "",
};
const people = new Map([[2, person(2, "Bob Tremblay")]]);

describe("TaskRow", () => {
  it("shows the icon and title, and ticks and opens separately", () => {
    const onToggle = vi.fn();
    const onOpen = vi.fn();
    render(<ul><TaskRow task={base} people={people} category={{ id: 1, name: "Office", icon: "🏢" }} canToggle onToggle={onToggle} onOpen={onOpen} /></ul>);
    expect(screen.getByText("🧹")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /Mop the floor/ }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Mop the floor/ }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("strikes a done task through and cannot be ticked when the person may not", () => {
    render(<ul><TaskRow task={{ ...base, status: "completed" }} people={people} canToggle={false} onToggle={() => {}} onOpen={() => {}} /></ul>);
    const box = screen.getByRole("checkbox", { name: /Mop the floor/ });
    expect(box).toBeChecked();
    expect(box).toBeDisabled();
    expect(screen.getByRole("button", { name: /Mop the floor/ }).closest("li")).toHaveClass("task--done");
  });

  it("shows a muted face for a person who is no longer active", () => {
    const gone = new Map([[2, { ...person(2, "Bob Tremblay"), active: false }]]);
    const { container } = render(<ul><TaskRow task={{ ...base, people: [2] }} people={gone} canToggle onToggle={() => {}} onOpen={() => {}} /></ul>);
    expect(container.querySelector(".avatar--muted")).not.toBeNull();
  });
});
