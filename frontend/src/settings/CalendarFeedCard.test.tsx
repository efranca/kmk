import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders, resetLanguage, useEnglish } from "../testUtils";
import { CalendarFeedCard } from "./CalendarFeedCard";

const URL = "https://app.kmk-entretien.ca/api/schedule/feed/secret123.ics";
const res = (status: number, body: unknown = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const NONE = { exists: false, created_at: null, last_used_at: null };
const SOME = { exists: true, created_at: "2026-11-20T10:00:00+00:00", last_used_at: null };

function mockApi(state: { info: unknown }) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const route = `${init?.method ?? "GET"} ${url}`;
    if (route === "GET /api/account/calendar-feed") return res(200, state.info);
    if (route === "POST /api/account/calendar-feed") { state.info = SOME; return res(201, { url: URL, created_at: SOME.created_at }); }
    if (route === "DELETE /api/account/calendar-feed") { state.info = NONE; return res(204); }
    throw new Error(`unexpected ${route}`);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}
const calls = (fn: ReturnType<typeof mockApi>, route: string) => fn.mock.calls.filter(([u, i]) => `${i?.method ?? "GET"} ${u}` === route);

beforeEach(async () => { await useEnglish(); });
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); await resetLanguage(); });

describe("CalendarFeedCard", () => {
  it("offers to create a link when there is none, with the warning", async () => {
    mockApi({ info: NONE });
    renderWithProviders(<CalendarFeedCard csrfToken="tok" />);
    expect(await screen.findByText("No link yet.")).toBeInTheDocument();
    expect(screen.getByText(/Anyone with this link can read your event titles and times/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create link" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Revoke link" })).toBeNull();
  });

  it("says where to paste the link in Google Calendar, Apple Calendar and Outlook, with no mention of FamillAI", async () => {
    mockApi({ info: NONE });
    const { container } = renderWithProviders(<CalendarFeedCard csrfToken="tok" />);
    const how = await screen.findByText(/Google Calendar: Other calendars, From URL/);
    expect(how).toHaveTextContent(/Apple Calendar: File, New Calendar Subscription/);
    expect(how).toHaveTextContent(/Outlook: Add calendar, Subscribe from web/);
    expect(container.textContent).not.toMatch(/FamillAI/i);
  });

  it("creates a link, shows it once and copies it", async () => {
    const fn = mockApi({ info: NONE });
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderWithProviders(<CalendarFeedCard csrfToken="tok" />);
    fireEvent.click(await screen.findByRole("button", { name: "Create link" }));
    const field = await screen.findByDisplayValue(URL);
    expect(field).toHaveAttribute("readonly");
    expect(screen.getByText("Copy this link now. It will not be shown again.")).toBeInTheDocument();
    const [post] = calls(fn, "POST /api/account/calendar-feed");
    expect((post[1] as RequestInit).headers).toMatchObject({ "X-CSRF-Token": "tok" });
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(URL));
  });

  it("does not show the link again after a reload", async () => {
    mockApi({ info: SOME });
    renderWithProviders(<CalendarFeedCard csrfToken="tok" />);
    expect(await screen.findByText(/A link is active since/)).toBeInTheDocument();
    expect(screen.queryByDisplayValue(URL)).toBeNull();
  });

  it("asks before revoking, then revokes", async () => {
    const fn = mockApi({ info: SOME });
    renderWithProviders(<CalendarFeedCard csrfToken="tok" />);
    fireEvent.click(await screen.findByRole("button", { name: "Revoke link" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Revoke the link? Every app using it stops updating.")).toBeInTheDocument();
    expect(calls(fn, "DELETE /api/account/calendar-feed")).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke link" }));
    await waitFor(() => expect(calls(fn, "DELETE /api/account/calendar-feed")).toHaveLength(1));
    expect(await screen.findByText("No link yet.")).toBeInTheDocument();
  });

  it("asks before replacing an existing link", async () => {
    const fn = mockApi({ info: SOME });
    renderWithProviders(<CalendarFeedCard csrfToken="tok" />);
    fireEvent.click(await screen.findByRole("button", { name: "Create a new link" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Create a new link? The current one stops working in every app.")).toBeInTheDocument();
    expect(calls(fn, "POST /api/account/calendar-feed")).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Create a new link" }));
    expect(await screen.findByDisplayValue(URL)).toBeInTheDocument();
  });
});
