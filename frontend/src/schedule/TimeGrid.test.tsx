import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ComponentProps } from "react";

import type { Task } from "../tasks/types";
import { occurrence, resetLanguage, useEnglish } from "../testUtils";
import { TimeGrid } from "./TimeGrid";

beforeEach(async () => {
  await resetLanguage();
  await useEnglish();
});

const piano = occurrence({ title: "Piano", start_time: "10:00", end_time: "11:00", icon: "🎹" });

describe("TimeGrid", () => {
  it("shows one column per day, the weekend ones marked, today highlighted", () => {
    render(<TimeGrid days={["2026-11-12", "2026-11-13", "2026-11-14"]} items={[]} today="2026-11-13" locale="en-US" />);
    expect(screen.getAllByRole("columnheader")).toHaveLength(3);
    expect([...document.querySelectorAll(".grid__col--weekend")].map((c) => c.getAttribute("data-date"))).toEqual(["2026-11-14"]);
    expect(screen.getByRole("columnheader", { current: "date" })).toHaveTextContent("13");
  });

  it("puts every hour of the day in the grid", () => {
    render(<TimeGrid days={["2026-11-12"]} items={[]} today="2026-11-12" locale="en-US" />);
    const hours = [...document.querySelectorAll(".grid__rail .grid__hour")].map((h) => h.textContent);
    expect(hours).toHaveLength(24);
    expect([hours[0], hours[23]]).toEqual(["00:00", "23:00"]);
  });

  it("shows a timed event in its day's column and opens it on click", () => {
    const onOpen = vi.fn();
    render(<TimeGrid days={["2026-11-12"]} items={[piano]} today="2026-11-12" locale="en-US" onOpenItem={onOpen} />);
    const block = screen.getByRole("button", { name: /Piano/ });
    expect(block.closest("[data-date]")?.getAttribute("data-date")).toBe("2026-11-12");
    expect(block).toHaveTextContent("🎹");
    fireEvent.click(block);
    expect(onOpen).toHaveBeenCalledWith(piano);
  });

  it("puts all-day events in the strip on top", () => {
    const holiday = occurrence({ title: "Holiday", all_day: true, start_time: null, end_time: null, date: "2026-11-13", original_date: "2026-11-13" });
    render(<TimeGrid days={["2026-11-12", "2026-11-13"]} items={[holiday]} today="2026-11-12" locale="en-US" />);
    const strip = document.querySelector('.grid__allday[data-date="2026-11-13"]') as HTMLElement;
    expect(within(strip).getByText("Holiday")).toBeInTheDocument();
  });

  it("places overlapping events side by side", () => {
    const a = occurrence({ title: "Alpha", start_time: "10:00", end_time: "11:00" });
    const b = occurrence({ title: "Beta", start_time: "10:30", end_time: "11:30" });
    render(<TimeGrid days={["2026-11-12"]} items={[a, b]} today="2026-11-12" locale="en-US" />);
    expect(screen.getByRole("button", { name: /Alpha/ }).style.width).toContain("50%");
    expect(screen.getByRole("button", { name: /Beta/ }).style.left).toBe("50%");
  });

  it("an empty spot reports the day and a half-hour minute", () => {
    const onCreateAt = vi.fn();
    render(<TimeGrid days={["2026-11-12"]} items={[]} today="2026-11-12" locale="en-US" onCreateAt={onCreateAt} />);
    const column = document.querySelector('.grid__col[data-date="2026-11-12"]') as HTMLElement;
    column.getBoundingClientRect = () => ({ top: 0, height: 1000, left: 0, right: 100, bottom: 1000, width: 100, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.click(column, { clientY: 500 });
    expect(onCreateAt).toHaveBeenCalledTimes(1);
    expect(onCreateAt.mock.calls[0]![0]).toBe("2026-11-12");
    expect(onCreateAt.mock.calls[0]![1] % 30).toBe(0);
  });
});

describe("TimeGrid dragging", () => {
  // a day column 1000px tall from y=0; with only the 10:00-11:00 event the hours 0-10 are compacted, so the event
  // starts 40% of the way down (see gridLayout.hourBands)
  const ROOM = { top: 0, height: 1000, left: 0, right: 100, bottom: 1000, width: 100, x: 0, y: 0, toJSON: () => ({}) };
  function grid(props: Partial<ComponentProps<typeof TimeGrid>> = {}) {
    const view = render(<TimeGrid days={["2026-11-12"]} items={[piano]} today="2026-11-12" locale="en-US" {...props} />);
    (document.querySelector('.grid__col[data-date="2026-11-12"]') as HTMLElement).getBoundingClientRect = () => ROOM;
    return view;
  }
  const pointer = (type: "pointerDown" | "pointerMove" | "pointerUp", el: Element | Window, y: number, extra = {}) =>
    fireEvent[type](el, { button: 0, pointerId: 1, pointerType: "mouse", clientX: 50, clientY: y, ...extra });

  it("gives an event a resize handle and the grab cursor only when it can be moved", () => {
    grid({ onMoveEvent: () => {} });
    const event = screen.getByRole("button", { name: /Piano/ });
    expect(event).toHaveClass("grid__event--movable");
    expect(event.querySelector(".grid__resize")).not.toBeNull();
  });

  it("is plain when nothing handles a move, or when this event may not be moved", () => {
    grid();
    expect(screen.getByRole("button", { name: /Piano/ })).not.toHaveClass("grid__event--movable");
    expect(screen.getByRole("button", { name: /Piano/ }).querySelector(".grid__resize")).toBeNull();
    cleanup();
    grid({ onMoveEvent: () => {}, canMove: () => false });
    expect(screen.getByRole("button", { name: /Piano/ })).not.toHaveClass("grid__event--movable");
  });

  it("a press without movement is a click: it opens the event and moves nothing", () => {
    const moved = vi.fn();
    const opened = vi.fn();
    grid({ onMoveEvent: moved, onOpenItem: opened });
    const event = screen.getByRole("button", { name: /Piano/ });
    pointer("pointerDown", event, 410);
    pointer("pointerUp", window, 410);
    fireEvent.click(event);
    expect(moved).not.toHaveBeenCalled();
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it("dragging an event down reports its new start, snapped to a quarter of an hour, with the same length", () => {
    const moved = vi.fn();
    const opened = vi.fn();
    grid({ onMoveEvent: moved, onOpenItem: opened });
    const event = screen.getByRole("button", { name: /Piano/ });
    pointer("pointerDown", event, 410);
    pointer("pointerMove", window, 470); // 7.5 minutes into the busy hour to 52.5: a move of 45 minutes
    pointer("pointerUp", window, 470);
    fireEvent.click(event); // the click that follows a drop is not a tap
    expect(moved).toHaveBeenCalledWith(piano, { date: "2026-11-12", start: "10:45", end: "11:45" });
    expect(opened).not.toHaveBeenCalled();
  });

  it("dragging the bottom edge keeps the start and changes the end", () => {
    const moved = vi.fn();
    grid({ onMoveEvent: moved });
    const handle = screen.getByRole("button", { name: /Piano/ }).querySelector(".grid__resize") as HTMLElement;
    pointer("pointerDown", handle, 450);
    pointer("pointerMove", window, 480);
    pointer("pointerUp", window, 480);
    expect(moved).toHaveBeenCalledTimes(1);
    const [, slot] = moved.mock.calls[0]!;
    expect(slot.start).toBe("10:00");
    expect(slot.end > "11:00").toBe(true);
  });

  it("an event dragged onto another day column lands on that day", () => {
    const moved = vi.fn();
    const view = render(<TimeGrid days={["2026-11-12", "2026-11-13"]} items={[piano]} today="2026-11-12" locale="en-US" onMoveEvent={moved} />);
    const rects: Record<string, [number, number]> = { "2026-11-12": [0, 100], "2026-11-13": [100, 200] };
    for (const [date, [left, right]] of Object.entries(rects)) {
      (view.container.querySelector(`.grid__col[data-date="${date}"]`) as HTMLElement).getBoundingClientRect = () => ({ ...ROOM, left, right, x: left });
    }
    const event = screen.getByRole("button", { name: /Piano/ });
    pointer("pointerDown", event, 410, { clientX: 50 });
    pointer("pointerMove", window, 410, { clientX: 150 });
    pointer("pointerUp", window, 410, { clientX: 150 });
    expect(moved).toHaveBeenCalledWith(piano, { date: "2026-11-13", start: "10:00", end: "11:00" });
  });

  it("puts a task in the all-day strip of its day; it can be ticked and opened, and never dragged", () => {
    const task = { id: 4, title: "Mop", icon: null, status: "pending", people: [] } as unknown as Task;
    const layer = { on: (d: string) => (d === "2026-11-12" ? [task] : []), canToggle: () => true, onToggle: vi.fn(), onOpen: vi.fn() };
    const onMove = vi.fn();
    render(<TimeGrid days={["2026-11-12", "2026-11-13"]} items={[]} today="2026-11-12" locale="en-US" tasks={layer} onMoveEvent={onMove} canMove={() => true} />);
    const strip = document.querySelector('.grid__allday[data-date="2026-11-12"]') as HTMLElement;
    fireEvent.click(within(strip).getByRole("checkbox", { name: "Mop" }));
    expect(layer.onToggle).toHaveBeenCalledWith(task);
    const open = within(strip).getByRole("button", { name: /Mop/ });
    fireEvent.pointerDown(open, { pointerId: 1, clientX: 5, clientY: 5 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 80, clientY: 200 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 80, clientY: 200 });
    expect(onMove).not.toHaveBeenCalled();
    fireEvent.click(open);
    expect(layer.onOpen).toHaveBeenCalledWith(task);
    expect(document.querySelector('.grid__allday[data-date="2026-11-13"] .grid__chip--task')).toBeNull();
  });
});
