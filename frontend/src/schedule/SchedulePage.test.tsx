import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";

import { mockApi, occurrence, person, renderWithProviders, reply, resetLanguage, useEnglish } from "../testUtils";
import { todayIn, COMPANY_TIME_ZONE } from "./scheduleDates";
import { SchedulePage } from "./SchedulePage";
import type { Task } from "../tasks/types";
import type { Occurrence } from "./types";

const alice = person(1, "Alice Roy", "red");
const leo = person(2, "Leo Tremblay", "green");

function Probe() {
  return <output data-testid="url">{useLocation().search}</output>;
}

function setup(items: Occurrence[], route = "/schedule?view=week&date=2026-11-12") {
  const api = mockApi({
    "GET /api/schedule/events": ({ url }) => {
      const q = url.searchParams.get("q");
      return { occurrences: q ? items.filter((i) => i.title.toLowerCase().includes(q.toLowerCase())) : items };
    },
    "GET /api/schedule/people": () => ({ people: [alice, leo] }),
  });
  const view = renderWithProviders(<><SchedulePage /><Probe /></>, { route });
  return { api, ...view };
}

const swimming = occurrence({ title: "Swimming", icon: "🏊", date: "2026-11-12", start_time: "18:00", end_time: "19:00", repeating: true });
const url = () => screen.getByTestId("url").textContent ?? "";

beforeEach(async () => {
  await resetLanguage();
  await useEnglish();
});

describe("SchedulePage time grid", () => {
  it("the week view shows seven columns with Swimming on Thursday", async () => {
    setup([swimming]);
    const block = await screen.findByText("Swimming");
    expect(screen.getAllByRole("columnheader")).toHaveLength(7);
    expect(block.closest("[data-date]")?.getAttribute("data-date")).toBe("2026-11-12");
  });

  it("the day view shows one column", async () => {
    setup([swimming], "/schedule?view=day&date=2026-11-12");
    await screen.findByText("Swimming");
    expect(screen.getAllByRole("columnheader")).toHaveLength(1);
  });

  it("an all-day event appears in the all-day strip", async () => {
    setup([occurrence({ title: "Holiday", all_day: true, date: "2026-11-13", original_date: "2026-11-13", start_time: null, end_time: null })]);
    const holiday = await screen.findByText("Holiday");
    expect(holiday.closest(".grid__allday")?.getAttribute("data-date")).toBe("2026-11-13");
  });

  it("weekend columns have the weekend class", async () => {
    setup([swimming]);
    await screen.findByText("Swimming");
    expect([...document.querySelectorAll(".grid__col--weekend")].map((c) => c.getAttribute("data-date"))).toEqual(["2026-11-08", "2026-11-14"]);
  });

  it("requests the week from its first to its last day", async () => {
    const { api } = setup([swimming]);
    await screen.findByText("Swimming");
    const call = api.calls.find((c) => c.path === "/api/schedule/events")!;
    expect(call.query).toContain("from=2026-11-08");
    expect(call.query).toContain("to=2026-11-14");
  });

  it("an event before the usual hours is still in the grid and every hour is reachable", async () => {
    setup([occurrence({ title: "Early shift", start_time: "06:30", end_time: "07:00" })]);
    expect(await screen.findByText("Early shift")).toBeInTheDocument();
    expect(document.querySelectorAll(".grid__rail .grid__hour")).toHaveLength(24);
  });
});

describe("SchedulePage navigation", () => {
  it("changing the view updates the URL", async () => {
    setup([swimming]);
    await screen.findByText("Swimming");
    await userEvent.click(screen.getByRole("radio", { name: "Day" }));
    expect(url()).toContain("view=day");
    await userEvent.click(screen.getByRole("radio", { name: "Week" }));
    expect(url()).toContain("view=week");
  });

  it("next and previous move by the view's length", async () => {
    setup([swimming]);
    await screen.findByText("Swimming");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(url()).toContain("date=2026-11-19");
    await userEvent.click(screen.getByRole("button", { name: "Previous" }));
    await userEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(url()).toContain("date=2026-11-05");
  });

  it("Today jumps to today in the company time zone", async () => {
    setup([swimming], "/schedule?view=week&date=2026-01-05");
    await userEvent.click(await screen.findByRole("button", { name: "Today" }));
    expect(url()).toContain(`date=${todayIn(COMPANY_TIME_ZONE)}`);
  });

  it("the month view opens a day in the Day view, the year view a month in the Month view", async () => {
    setup([swimming], "/schedule?view=month&date=2026-11-12");
    await userEvent.click(await screen.findByRole("button", { name: /November 12/ }));
    expect(url()).toContain("view=day");
    expect(url()).toContain("date=2026-11-12");
  });

  it("the year view lists twelve months and a month opens the Month view", async () => {
    setup([swimming], "/schedule?view=year&date=2026-11-12");
    await userEvent.click(await screen.findByRole("button", { name: "March" }));
    expect(url()).toContain("view=month");
    expect(url()).toContain("date=2026-03-01");
  });
});

describe("SchedulePage people filter", () => {
  it("picking a person asks for that person's events and puts it in the URL", async () => {
    const { api } = setup([swimming]);
    await screen.findByText("Swimming");
    const faces = await screen.findByRole("group", { name: "Show" });
    expect(within(faces).getByRole("button", { name: "Everyone" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(within(faces).getByRole("button", { name: "Leo Tremblay" }));
    await waitFor(() => expect(api.calls.some((c) => c.path === "/api/schedule/events" && c.query.includes("people=2"))).toBe(true));
    expect(url()).toContain("people=2");
    expect(within(faces).getByRole("button", { name: "Everyone" })).toHaveAttribute("aria-pressed", "false");
  });

  it("several people go together, and Everyone clears them", async () => {
    const { api } = setup([swimming]);
    await screen.findByText("Swimming");
    const faces = await screen.findByRole("group", { name: "Show" });
    await userEvent.click(within(faces).getByRole("button", { name: "Leo Tremblay" }));
    await userEvent.click(within(faces).getByRole("button", { name: "Alice Roy" }));
    await waitFor(() => expect(api.calls.some((c) => decodeURIComponent(c.query).includes("people=1,2"))).toBe(true));
    await userEvent.click(within(faces).getByRole("button", { name: "Everyone" }));
    expect(url()).not.toContain("people=");
  });
});

describe("SchedulePage search", () => {
  it("is hidden until the magnifier is pressed; pressing it again closes and clears it", async () => {
    setup([swimming]);
    await screen.findByText("Swimming");
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    const magnifier = screen.getByRole("button", { name: "Search events" });
    expect(magnifier).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(magnifier);
    expect(magnifier).toHaveAttribute("aria-pressed", "true");
    await userEvent.type(screen.getByRole("searchbox"), "sw");
    await userEvent.click(magnifier);
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("shows results and hides the grid", async () => {
    const { api } = setup([swimming, occurrence({ title: "Dentist" })]);
    await screen.findByText("Swimming");
    await userEvent.click(screen.getByRole("button", { name: "Search events" }));
    await userEvent.type(screen.getByRole("searchbox"), "swim");
    const results = await screen.findByRole("region", { name: "Search results" });
    expect(await within(results).findByText("Swimming")).toBeInTheDocument();
    expect(within(results).queryByText("Dentist")).toBeNull();
    expect(screen.queryAllByRole("columnheader")).toHaveLength(0);
    expect(api.calls.some((c) => c.query.includes("q=swim"))).toBe(true);
    expect(url()).toContain("q=swim");
  });

  it("a search shorter than two characters does not call the API", async () => {
    const { api } = setup([swimming]);
    await screen.findByText("Swimming");
    await userEvent.click(screen.getByRole("button", { name: "Search events" }));
    await userEvent.type(screen.getByRole("searchbox"), "s");
    await new Promise((r) => setTimeout(r, 450));
    expect(api.calls.some((c) => c.query.includes("q="))).toBe(false);
    expect(screen.getAllByRole("columnheader")).toHaveLength(7);
  });

  it("no match shows an empty state", async () => {
    setup([swimming], "/schedule?view=week&date=2026-11-12&q=zzz");
    expect(await screen.findByText("Nothing matches “zzz”")).toBeInTheDocument();
  });

  it("clicking a result opens that day", async () => {
    setup([swimming], "/schedule?view=week&date=2026-11-12&q=swim");
    const results = await screen.findByRole("region", { name: "Search results" });
    await userEvent.click(await within(results).findByRole("button", { name: /Swimming/ }));
    expect(url()).toContain("view=day");
    expect(url()).toContain("date=2026-11-12");
    expect(url()).not.toContain("q=");
  });
});

describe("SchedulePage errors", () => {
  it("shows an error with retry when the schedule cannot be loaded", async () => {
    mockApi({
      "GET /api/schedule/events": () => reply(500, { error: "internal_error" }),
      "GET /api/schedule/people": () => ({ people: [alice] }),
    });
    renderWithProviders(<SchedulePage />, { route: "/schedule?view=week&date=2026-11-12" });
    expect(await screen.findByRole("button", { name: /try again|retry|réessayer/i })).toBeInTheDocument();
  });
});

describe("SchedulePage actions", () => {
  const eventDetail = {
    id: 1, title: "Swimming", notes: null, icon: null, color: null, display_color: "blue", all_day: false, start_date: "2026-11-12", start_time: "18:00",
    duration_minutes: 60, recurrence: null, ends_on: null, max_count: null, people: [], reminders: [], exceptions: [], created_by: 1, updated_by: 1,
  };
  const open = () => {
    mockApi({
      "GET /api/schedule/events": () => ({ occurrences: [{ ...swimming, event_id: 1, repeating: false }] }),
      "GET /api/schedule/events/1": () => ({ event: eventDetail }),
      "GET /api/schedule/people": () => ({ people: [alice] }),
    });
    renderWithProviders(<SchedulePage />, { route: "/schedule?view=week&date=2026-11-12" });
  };

  it("clicking an event opens it in the dialog", async () => {
    open();
    await userEvent.click(await screen.findByRole("button", { name: /Swimming/ }));
    expect(await screen.findByRole("dialog", { name: "Edit event" })).toBeInTheDocument();
    expect(await screen.findByDisplayValue("Swimming")).toBeInTheDocument();
  });

  it("the plus button opens a new event, on today when the view is a week", async () => {
    open();
    await screen.findByRole("button", { name: /Swimming/ });
    await userEvent.click(screen.getByRole("button", { name: "Add event" }));
    expect(await screen.findByRole("dialog", { name: "New event" })).toBeInTheDocument();
    expect(screen.getByLabelText("Date")).toHaveValue(todayIn(COMPANY_TIME_ZONE));
  });

  it("an empty spot of the grid opens a new event at that day and time", async () => {
    open();
    await screen.findByRole("button", { name: /Swimming/ });
    const column = document.querySelector('.grid__col[data-date="2026-11-13"]') as HTMLElement;
    column.getBoundingClientRect = () => ({ top: 0, height: 1000, left: 0, right: 100, bottom: 1000, width: 100, x: 0, y: 0, toJSON: () => ({}) });
    await userEvent.pointer({ target: column, keys: "[MouseLeft]", coords: { clientY: 500 } });
    expect(await screen.findByRole("dialog", { name: "New event" })).toBeInTheDocument();
    expect(screen.getByLabelText("Date")).toHaveValue("2026-11-13");
  });
});

describe("SchedulePage tasks", () => {
  const dueTask: Task = {
    id: 11, title: "Mop the floor", description: null, icon: "🧹", category_id: null, people: [], status: "pending", due_date: "2026-11-12", completed_at: null,
    show_on_dashboard: true, created_by: { id: 1, name: "Alice Roy" }, updated_by: { id: 1, name: "Alice Roy" }, created_at: "2026-11-01T12:00:00Z", updated_at: "2026-11-01T12:00:00Z",
  };
  function withTasks(route: string) {
    const api = mockApi({
      "GET /api/schedule/events": () => ({ occurrences: [] }),
      "GET /api/schedule/people": () => ({ people: [alice, leo] }),
      "GET /api/tasks": () => ({ tasks: [dueTask] }),
      "GET /api/tasks/categories": () => ({ categories: [] }),
      "POST /api/tasks/11/complete": () => ({ task: { ...dueTask, status: "completed" } }),
      "PATCH /api/me/preferences": () => ({ preferences: {} }),
    });
    renderWithProviders(<><SchedulePage /><Probe /></>, { route });
    return api;
  }
  beforeEach(() => localStorage.clear());

  it("shows no tasks, and never asks for them, while the switch is off", async () => {
    const api = withTasks("/schedule?view=month&date=2026-11-12");
    await screen.findByRole("button", { name: "Show tasks" });
    expect(screen.queryByText("Mop the floor")).not.toBeInTheDocument();
    expect(api.calls.some((c) => c.path === "/api/tasks")).toBe(false);
  });

  it("shows a task with a due date as a chip on its day once the switch is on", async () => {
    withTasks("/schedule?view=month&date=2026-11-12");
    await userEvent.click(await screen.findByRole("button", { name: "Show tasks" }));
    const chip = await screen.findByText("Mop the floor");
    expect(chip.closest("[data-date]")?.getAttribute("data-date")).toBe("2026-11-12");
    expect(screen.getByRole("button", { name: "Show tasks" })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows it in the all-day strip of the week view, and ticking the chip completes the task", async () => {
    const api = withTasks("/schedule?view=week&date=2026-11-12");
    await userEvent.click(await screen.findByRole("button", { name: "Show tasks" }));
    await screen.findByText("Mop the floor");
    await userEvent.click(screen.getByRole("checkbox", { name: "Mop the floor" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST" && c.path === "/api/tasks/11/complete")).toBe(true));
  });

  it("a task chip opens the task, not an event", async () => {
    withTasks("/schedule?view=month&date=2026-11-12");
    await userEvent.click(await screen.findByRole("button", { name: "Show tasks" }));
    await userEvent.click(await screen.findByText("Mop the floor"));
    expect(await screen.findByRole("dialog", { name: "Task" })).toBeInTheDocument();
  });

  it("marks a day with a task in the year view", async () => {
    withTasks("/schedule?view=year&date=2026-11-12");
    await userEvent.click(await screen.findByRole("button", { name: "Show tasks" }));
    await waitFor(() => expect(document.querySelector('[data-date="2026-11-12"] .year__dot')).not.toBeNull());
  });
});
