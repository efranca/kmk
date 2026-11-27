import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_PREFERENCES } from "../preferences";
import { mockApi, renderWithProviders, resetLanguage, testUser, useEnglish } from "../testUtils";
import { DashboardPage } from "./DashboardPage";

function setup(widgets: Partial<typeof DEFAULT_PREFERENCES.dashboard_widgets>, role: "user" | "admin" = "user") {
  const api = mockApi({
    "GET /api/quotes": { quotes: [], counts: { new: 0, customer_replied: 0, replied: 0 } },
    "GET /api/schedule/events": () => ({ occurrences: [] }),
    "GET /api/schedule/people": () => ({ people: [] }),
    "GET /api/tasks": () => ({ tasks: [] }),
    "GET /api/clients": () => ({ clients: [{ id: 5, name: "Chantal Roy", kind: "airbnb", contact_name: null, email: "c@example.com", phone: "418-555-0101", address: "12 rue Saint-Jean", city: "Québec", created_at: "", updated_at: "" }] }),
    "GET /api/tasks/categories": () => ({ categories: [] }),
  });
  const user = { ...testUser, role };
  renderWithProviders(<DashboardPage user={user} mfaEnabled recoveryCodesLeft={null} />, {
    session: { user },
    preferences: { ...DEFAULT_PREFERENCES, dashboard_widgets: { ...DEFAULT_PREFERENCES.dashboard_widgets, ...widgets } },
  });
  return api;
}

beforeEach(async () => { await useEnglish(); });
afterEach(async () => { await resetLanguage(); });

describe("Dashboard widget switches", () => {
  it("shows every card by default", async () => {
    setup({});
    expect(await screen.findByRole("region", { name: "My events" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "All events" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "My tasks" })).toBeInTheDocument();
  });

  it("hides the cards switched off", async () => {
    setup({ my_tasks: false, all_events: false });
    expect(await screen.findByRole("region", { name: "My events" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "All events" })).toBeNull();
    expect(screen.queryByRole("region", { name: "My tasks" })).toBeNull();
  });

  it("says so, with a link to Settings, when every card is off", async () => {
    setup({ my_events: false, all_events: false, my_tasks: false, my_clients: false });
    expect(await screen.findByText(/All Dashboard cards are hidden/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  });

  it("shows the two quote cards to an admin, and each can be switched off", async () => {
    setup({}, "admin");
    expect(await screen.findByRole("region", { name: "Quotes" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Latest quotes" })).toBeInTheDocument();
    cleanup();
    setup({ quotes_summary: false, quotes_latest: false }, "admin");
    expect(await screen.findByRole("region", { name: "My events" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Quotes" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Latest quotes" })).toBeNull();
  });

  it("never shows or asks for quotes for a regular user", async () => {
    const api = setup({}, "user");
    expect(await screen.findByRole("region", { name: "My events" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Quotes" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Latest quotes" })).toBeNull();
    expect(api.calls.some((c) => c.path === "/api/quotes")).toBe(false);
  });

  it("shows Staff the clients they are scheduled for, with how to reach them, and never to admins", async () => {
    setup({}, "user");
    const card = await screen.findByRole("region", { name: "My clients" });
    expect(await within(card).findByText("Chantal Roy")).toBeInTheDocument();
    expect(within(card).getByText("12 rue Saint-Jean, Québec")).toBeInTheDocument();
    expect(within(card).getByText("418-555-0101")).toBeInTheDocument();
    cleanup();
    setup({}, "admin");
    await screen.findByRole("region", { name: "My events" });
    expect(screen.queryByRole("region", { name: "My clients" })).toBeNull();
  });

  it("says every card is hidden for a regular user whose classic cards are off", async () => {
    setup({ my_events: false, all_events: false, my_tasks: false, my_clients: false }, "user");
    expect(await screen.findByText(/All Dashboard cards are hidden/)).toBeInTheDocument();
  });
});
