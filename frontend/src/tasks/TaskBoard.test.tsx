import { createEvent, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetLanguage, useEnglish } from "../testUtils";
import { TaskBoard } from "./TaskBoard";
import type { Task, TaskStatus } from "./types";

let n = 0;
const task = (over: Partial<Task> = {}): Task => {
  n += 1;
  return {
    id: n, title: `Task ${n}`, description: null, icon: null, category_id: null, people: [], status: "pending", due_date: null,
    completed_at: null, show_on_dashboard: true, created_by: { id: 1, name: "A" }, updated_by: { id: 1, name: "A" },
    created_at: "2026-11-01T12:00:00Z", updated_at: "", ...over,
  };
};

beforeEach(async () => { await useEnglish(); });
afterEach(async () => { await resetLanguage(); });

function setup(tasks: Task[], canMove: (t: Task) => boolean = () => true, narrow = false) {
  const onMove = vi.fn<(t: Task, s: TaskStatus) => void>();
  const onOpen = vi.fn();
  render(<TaskBoard tasks={tasks} people={new Map()} categoryById={new Map()} today="2026-11-24" canMove={canMove} onMove={onMove} onOpen={onOpen} narrow={narrow} />);
  return { onMove, onOpen };
}
const column = (name: string) => screen.getByRole("group", { name: new RegExp(`^${name}`) });

function drag(card: HTMLElement, target: HTMLElement) {
  const data = new Map<string, string>();
  const transfer = { setData: (k: string, v: string) => data.set(k, v), getData: (k: string) => data.get(k) ?? "", effectAllowed: "", dropEffect: "" };
  fireEvent.dragStart(card, { dataTransfer: transfer });
  fireEvent.dragOver(target, { dataTransfer: transfer });
  const drop = createEvent.drop(target, { dataTransfer: transfer });
  fireEvent(target, drop);
}

describe("TaskBoard", () => {
  it("puts each task in the column of its status, with counts", () => {
    setup([task({ title: "A" }), task({ title: "B", status: "in_progress" }), task({ title: "C", status: "completed", completed_at: "2026-11-20T10:00:00Z" }), task({ title: "D" })]);
    expect(within(column("To do")).getByText("A")).toBeInTheDocument();
    expect(within(column("To do")).getByText("D")).toBeInTheDocument();
    expect(within(column("In progress")).getByText("B")).toBeInTheDocument();
    expect(within(column("Done")).getByText("C")).toBeInTheDocument();
    expect(column("To do")).toHaveAccessibleName("To do 2");
  });

  it("sorts a column by due date, undated last", () => {
    setup([task({ title: "Later", due_date: "2026-12-01" }), task({ title: "None" }), task({ title: "Soon", due_date: "2026-11-25" })]);
    const titles = within(column("To do")).getAllByRole("listitem").map((li) => li.textContent);
    expect(titles[0]).toContain("Soon");
    expect(titles[1]).toContain("Later");
    expect(titles[2]).toContain("None");
  });

  it("dropping a card on another column moves it", () => {
    const { onMove } = setup([task({ title: "A" })]);
    drag(within(column("To do")).getByText("A").closest("li")!, column("In progress"));
    expect(onMove).toHaveBeenCalledWith(expect.objectContaining({ title: "A" }), "in_progress");
  });

  it("dropping on its own column does nothing", () => {
    const { onMove } = setup([task({ title: "A" })]);
    drag(within(column("To do")).getByText("A").closest("li")!, column("To do"));
    expect(onMove).not.toHaveBeenCalled();
  });

  it("a card the person may not move is not draggable and has no move control", () => {
    setup([task({ title: "A" })], () => false);
    const card = screen.getByText("A").closest("li")!;
    expect(card).not.toHaveAttribute("draggable", "true");
    expect(within(card).queryByRole("combobox")).toBeNull();
  });

  it("the Move to control moves a card without dragging", () => {
    const { onMove } = setup([task({ title: "A" })]);
    fireEvent.change(screen.getByRole("combobox", { name: "Move A to" }), { target: { value: "completed" } });
    expect(onMove).toHaveBeenCalledWith(expect.objectContaining({ title: "A" }), "completed");
  });

  it("opens a task from its card", () => {
    const { onOpen } = setup([task({ title: "A" })]);
    fireEvent.click(screen.getByRole("button", { name: /A/ }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ title: "A" }));
  });
});


describe("on a phone", () => {
  const mixed = () => [task({ title: "Todo one" }), task({ title: "Doing one", status: "in_progress" }), task({ title: "Doing two", status: "in_progress" }), task({ title: "Done one", status: "completed" })];

  it("shows one column at a time, chosen with tabs that carry the counts, instead of scrolling sideways", () => {
    setup(mixed(), () => true, true);
    expect(screen.getAllByRole("radio").map((r) => r.textContent)).toEqual(["To do 1", "In progress 2", "Done 1"]);
    expect(screen.getByText("Todo one")).toBeInTheDocument();
    expect(screen.queryByText("Doing one")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "In progress 2" }));
    expect(screen.getByText("Doing one")).toBeInTheDocument();
    expect(screen.getByText("Doing two")).toBeInTheDocument();
    expect(screen.queryByText("Todo one")).toBeNull();
    expect(screen.getAllByRole("group")).toHaveLength(1);
  });

  it("starts on To do and opens a card", () => {
    const { onOpen } = setup(mixed(), () => true, true);
    expect(screen.getByRole("radio", { name: "To do 1" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: /Todo one/ }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ title: "Todo one" }));
  });

  it("moves a card with its control, which sends it to the other tab", () => {
    const { onMove } = setup(mixed(), () => true, true);
    fireEvent.change(screen.getByLabelText(/Move .*Todo one/i), { target: { value: "in_progress" } });
    expect(onMove).toHaveBeenCalledWith(expect.objectContaining({ title: "Todo one" }), "in_progress");
  });

  it("tells when the tab is empty", () => {
    setup([task({ title: "Only todo" })], () => true, true);
    fireEvent.click(screen.getByRole("radio", { name: "Done 0" }));
    expect(screen.getByText(/nothing here/i)).toBeInTheDocument();
  });

  it("keeps all three columns on a wide screen", () => {
    setup(mixed());
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getAllByRole("group")).toHaveLength(3);
  });
});
