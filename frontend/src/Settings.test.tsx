import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import i18n from "./i18n";
import { forgetToken } from "./route";
import { DEFAULT_PREFERENCES } from "./preferences";
import SettingsPage from "./SettingsPage";
import { Providers } from "./testUtils";
import frCA from "./locales/fr-CA.json";

const res = (status: number, body: unknown = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const signedIn = () => res(200, { user: { id: 1, username: "alice", email: "a@example.com", role: "user", locale: "fr-CA" }, csrf_token: "t", mfa: "ok", mfa_enabled: false });
const visit = (path: string) => window.history.pushState({}, "", path);

function mockApi(authed: boolean) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const route = `${init?.method ?? "GET"} ${url}`;
    if (route === "GET /api/auth/me") return authed ? signedIn() : res(401, { error: "unauthenticated" });
    if (route.startsWith("GET /api/schedule/events")) return res(200, { occurrences: [] });
    if (route === "GET /api/schedule/people") return res(200, { people: [] });
    if (route === "GET /api/schedule/reminders/due") return res(200, { reminders: [] });
    throw new Error(`unexpected ${route}`);
  }));
}

beforeEach(() => localStorage.clear());
afterEach(async () => {
  cleanup();
  forgetToken();
  visit("/");
  delete document.documentElement.dataset.theme;
  await act(() => i18n.changeLanguage("fr-CA"));
});

describe("Settings page", () => {
  it("offers the three themes with the saved one selected", () => {
    render(<Providers preferences={{ ...DEFAULT_PREFERENCES, theme: "light" }}><SettingsPage /></Providers>);
    expect(screen.getByRole("radio", { name: frCA.themeKmk })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("radio", { name: frCA.themeLight })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: frCA.themeDark })).toBeInTheDocument();
  });

  it("applies and remembers the chosen theme", () => {
    render(<Providers><SettingsPage /></Providers>);
    fireEvent.click(screen.getByRole("radio", { name: frCA.themeDark }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("kmk.theme")).toBe("dark");
    expect(screen.getByRole("radio", { name: frCA.themeDark })).toHaveAttribute("aria-checked", "true");
  });

  it("has a switch per Dashboard card, on by default, and saves a change to the account", async () => {
    const fetchMock = vi.fn(async () => res(200, { preferences: {} }));
    vi.stubGlobal("fetch", fetchMock);
    render(<Providers><SettingsPage /></Providers>);
    for (const name of [frCA.settingsWidgetMyEvents, frCA.settingsWidgetAllEvents, frCA.settingsWidgetMyTasks]) {
      expect(screen.getByRole("switch", { name })).toBeChecked();
    }
    fireEvent.click(screen.getByRole("switch", { name: frCA.settingsWidgetMyTasks }));
    expect(screen.getByRole("switch", { name: frCA.settingsWidgetMyTasks })).not.toBeChecked();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(init.body))).toEqual({ dashboard_widgets: { my_tasks: false } });
  });

  it("is a page of its own for signed-in people", async () => {
    visit("/settings");
    mockApi(true);
    render(<App />);
    expect(await screen.findByRole("heading", { level: 1, name: frCA.settingsTitle })).toBeInTheDocument();
  });

  it("sends anonymous visitors to sign-in", async () => {
    visit("/settings");
    mockApi(false);
    render(<App />);
    expect(await screen.findByRole("heading", { name: frCA.signInTitle })).toBeInTheDocument();
  });
});
