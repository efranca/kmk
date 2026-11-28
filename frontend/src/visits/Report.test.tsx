import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { TFunction } from "i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "../i18n";
import { addDays, COMPANY_TIME_ZONE, todayIn } from "../schedule/scheduleDates";
import { mockApi, renderWithProviders, resetLanguage, testUser, useEnglish } from "../testUtils";
import { starterRooms } from "./rooms";
import { VisitsReportPage } from "./VisitsReportPage";

const admin = { session: { user: { ...testUser, role: "admin" as const } } };

const SUMMARY = {
  people: [
    { user_id: 2, name: "Ana", visits: 12, corrected: 0, without_photos: 0 },
    { user_id: 3, name: "Bruno", visits: 9, corrected: 1, without_photos: 0 },
    { user_id: 4, name: "Carla", visits: 7, corrected: 0, without_photos: 2 },
    { user_id: null, name: "Former colleague", visits: 1, corrected: 0, without_photos: 0 },
  ],
  open: [{ event_id: 8, occurrence_date: "2026-11-20", date: "2026-11-21", client_name: "Chantal Roy", property_name: "Beach house", people: ["Ana", "Bruno"] }],
};
const DETAIL = {
  visits: [
    { event_id: 3, occurrence_date: "2026-11-18", date: "2026-11-18", client_name: "Chantal Roy", property_name: "Beach house", checked_in_at: "08:02", closed_at: "11:15", photos: 6, without_photos: false, corrected: true, checked_in_by_name: "Bruno" },
    { event_id: null, occurrence_date: "2026-11-19", date: "2026-11-19", client_name: "Marc Gagnon", property_name: "Office", checked_in_at: "13:00", closed_at: "14:30", photos: 0, without_photos: true, corrected: false, checked_in_by_name: "Carla" },
  ],
};

beforeEach(async () => { await useEnglish(); });
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); await resetLanguage(); });

const today = () => todayIn(COMPANY_TIME_ZONE);

function open(handlers: Record<string, unknown> = {}) {
  const api = mockApi({ "GET /api/visits/report": SUMMARY, "GET /api/visits/report/4": DETAIL, ...handlers });
  renderWithProviders(<VisitsReportPage />, admin);
  return api;
}

describe("starterRooms", () => {
  const t = i18n.t.bind(i18n) as TFunction;
  it("suggests rooms by property kind, in the person's language", () => {
    expect(starterRooms("airbnb", t)).toEqual(["Kitchen", "Living room", "Bathroom", "Bedroom", "Entrance"]);
    expect(starterRooms("commercial", t)).toEqual(["Reception", "Offices", "Washrooms", "Kitchenette"]);
    expect(starterRooms("post_construction", t)).toEqual(["Kitchen", "Living room", "Bathroom", "Bedroom"]);
    expect(starterRooms("other", t)).toEqual(["Kitchen", "Bathroom"]);
  });
});

describe("the Visits done report", () => {
  it("asks for the last 14 days ending today by default, and lists each person's counts and markers", async () => {
    const api = open();
    const table = await screen.findByRole("table");
    expect(screen.getByRole("heading", { level: 1, name: "Visits done" })).toBeInTheDocument();
    expect(screen.getByLabelText("From")).toHaveValue(addDays(today(), -13));
    expect(screen.getByLabelText("To")).toHaveValue(today());
    const get = api.calls.find((c) => c.path === "/api/visits/report")!;
    expect(new URLSearchParams(get.query).get("from")).toBe(addDays(today(), -13));
    expect(new URLSearchParams(get.query).get("to")).toBe(today());
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(5); // the header and four people
    expect(rows[1]).toHaveTextContent(/Ana\s*12\s*0\s*0/);
    expect(rows[2]).toHaveTextContent(/Bruno\s*9\s*1\s*0/);
    expect(rows[3]).toHaveTextContent(/Carla\s*7\s*0\s*2/);
    expect(within(table).getByRole("columnheader", { name: "Corrected" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Closed without photos" })).toBeInTheDocument();
    // an account that no longer exists keeps its count, without a detail to open
    expect(within(rows[4]!).queryByRole("button")).toBeNull();
    expect(rows[4]).toHaveTextContent("Former colleague");
  });

  it("lists the visits that were not closed apart, with a link to each", async () => {
    open();
    const section = within(await screen.findByRole("region", { name: "Not closed" }));
    expect(section.getByText(/Chantal Roy · Beach house/)).toBeInTheDocument();
    expect(section.getByText(/Ana, Bruno/)).toBeInTheDocument();
    expect(section.getByRole("link", { name: /Open check-in/ })).toHaveAttribute("href", "/visits?event=8&date=2026-11-20");
  });

  it("offers the CSV of the range shown, as a plain download link that follows the range", async () => {
    open();
    await screen.findByRole("table");
    const link = screen.getByRole("link", { name: "Export CSV" });
    expect(link).toHaveAttribute("download");
    expect(link).toHaveAttribute("href", `/api/visits/report.csv?from=${addDays(today(), -13)}&to=${today()}`);
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-10-31" } });
    expect(screen.getByRole("link", { name: "Export CSV" })).toHaveAttribute("href", "/api/visits/report.csv?from=2026-10-01&to=2026-10-31");
  });

  it("checks the range before asking: the start after the end, or more than 366 days", async () => {
    const api = open();
    await screen.findByRole("table");
    const asked = () => api.calls.filter((c) => c.path === "/api/visits/report").length;
    const before = asked();
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-01-10" } });
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-01-11" } });
    expect(await screen.findByText("The start date must be on or before the end date.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Export CSV" })).toBeNull();
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2025-01-09" } }); // 367 days
    expect(screen.getByText("Choose at most 366 days.")).toBeInTheDocument();
    expect(asked()).toBe(before);
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2025-01-10" } }); // 366 days: allowed
    await waitFor(() => expect(api.calls.some((c) => c.path === "/api/visits/report" && c.query === "?from=2025-01-10&to=2026-01-10")).toBe(true));
    expect(screen.queryByText("Choose at most 366 days.")).toBeNull();
  });

  it("opens a person's visits: date, client, property, photos and markers, times as proof only", async () => {
    const api = open();
    fireEvent.click(await screen.findByRole("button", { name: "Carla" }));
    const detail = within(await screen.findByRole("region", { name: "Visits of Carla" }));
    const items = await detail.findAllByRole("listitem");
    expect(items).toHaveLength(2);
    const call = api.calls.find((c) => c.path === "/api/visits/report/4")!;
    expect(call.query).toBe(`?from=${addDays(today(), -13)}&to=${today()}`);
    expect(items[0]).toHaveTextContent("Nov 18, 2026");
    expect(items[0]).toHaveTextContent("Chantal Roy · Beach house");
    expect(items[0]).toHaveTextContent("6 photos");
    expect(items[0]).toHaveTextContent("Corrected");
    expect(items[0]).toHaveTextContent("08:02");
    expect(items[0]).toHaveTextContent("11:15");
    expect(items[0]).toHaveTextContent("marked by Bruno");
    expect(items[0]).not.toHaveTextContent("Closed without photos");
    expect(items[1]).toHaveTextContent("Closed without photos");
    expect(items[1]).toHaveTextContent("0 photos");
    expect(items[1]).not.toHaveTextContent("marked by"); // checked in by herself
    expect(detail.getByRole("link", { name: /Open check-in/ })).toHaveAttribute("href", "/visits?event=3&date=2026-11-18");
    // proof only: never a duration or a total of hours
    expect(document.body.textContent).not.toMatch(/hour|\bh\b|3:13|1:30/i);
  });

  it("says when nothing was done in the range", async () => {
    open({ "GET /api/visits/report": { people: [], open: [] } });
    expect(await screen.findByText("No visit was closed in this period.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Not closed" })).toBeNull();
  });
});
