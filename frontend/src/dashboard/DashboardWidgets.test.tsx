import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_PREFERENCES } from "../preferences";
import { mockApi, renderWithProviders, resetLanguage, testUser, useEnglish } from "../testUtils";
import { DashboardPage } from "./DashboardPage";

function setup(widgets: Partial<typeof DEFAULT_PREFERENCES.dashboard_widgets>) {
  mockApi({
    "GET /api/schedule/events": () => ({ occurrences: [] }),
    "GET /api/schedule/people": () => ({ people: [] }),
    "GET /api/tasks": () => ({ tasks: [] }),
    "GET /api/tasks/categories": () => ({ categories: [] }),
  });
  renderWithProviders(<DashboardPage user={testUser} mfaEnabled recoveryCodesLeft={null} />, {
    preferences: { ...DEFAULT_PREFERENCES, dashboard_widgets: { ...DEFAULT_PREFERENCES.dashboard_widgets, ...widgets } },
  });
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
    setup({ my_events: false, all_events: false, my_tasks: false });
    expect(await screen.findByText(/All Dashboard cards are hidden/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  });
});
