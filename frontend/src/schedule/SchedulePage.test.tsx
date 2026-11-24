import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockApi, occurrence, person, renderWithProviders, reply, resetLanguage, useEnglish } from "../testUtils";
import { todayIn, COMPANY_TIME_ZONE } from "./scheduleDates";
import { SchedulePage } from "./SchedulePage";
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
  it("opening an event or adding one is reported to the caller", async () => {
    const onOpenEvent = vi.fn();
    const onCreate = vi.fn();
    mockApi({
      "GET /api/schedule/events": () => ({ occurrences: [swimming] }),
      "GET /api/schedule/people": () => ({ people: [alice] }),
    });
    renderWithProviders(<SchedulePage onOpenEvent={onOpenEvent} onCreate={onCreate} />, { route: "/schedule?view=week&date=2026-11-12" });
    await userEvent.click(await screen.findByRole("button", { name: /Swimming/ }));
    expect(onOpenEvent).toHaveBeenCalledWith(swimming);
    await userEvent.click(screen.getByRole("button", { name: "Add event" }));
    expect(onCreate).toHaveBeenCalledWith(todayIn(COMPANY_TIME_ZONE));
  });
});
