import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import i18n from "./i18n";
import { forgetToken } from "./route";
import { DEFAULT_PREFERENCES } from "./preferences";
import SettingsPage from "./SettingsPage";
import { Providers, testUser } from "./testUtils";
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
    render(<Providers preferences={{ ...DEFAULT_PREFERENCES, theme: "light" }}><SettingsPage onLanguageChanged={vi.fn()} /></Providers>);
    expect(screen.getByRole("radio", { name: frCA.themeKmk })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("radio", { name: frCA.themeLight })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: frCA.themeDark })).toBeInTheDocument();
  });

  it("applies and remembers the chosen theme", () => {
    render(<Providers><SettingsPage onLanguageChanged={vi.fn()} /></Providers>);
    fireEvent.click(screen.getByRole("radio", { name: frCA.themeDark }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("kmk.theme")).toBe("dark");
    expect(screen.getByRole("radio", { name: frCA.themeDark })).toHaveAttribute("aria-checked", "true");
  });

  it("has a switch per Dashboard card, on by default, and saves a change to the account", async () => {
    const fetchMock = vi.fn(async () => res(200, { preferences: {} }));
    vi.stubGlobal("fetch", fetchMock);
    render(<Providers><SettingsPage onLanguageChanged={vi.fn()} /></Providers>);
    for (const name of [frCA.settingsWidgetMyEvents, frCA.settingsWidgetAllEvents, frCA.settingsWidgetMyTasks]) {
      expect(screen.getByRole("switch", { name })).toBeChecked();
    }
    fireEvent.click(screen.getByRole("switch", { name: frCA.settingsWidgetMyTasks }));
    expect(screen.getByRole("switch", { name: frCA.settingsWidgetMyTasks })).not.toBeChecked();
    const patch = () => (fetchMock.mock.calls as unknown as [string, RequestInit][]).find(([url]) => url === "/api/me/preferences");
    await waitFor(() => expect(patch()).toBeDefined());
    const init = patch()![1];
    expect(JSON.parse(String(init.body))).toEqual({ dashboard_widgets: { my_tasks: false } });
  });

  it("offers the quote card switches to admins only, and saves a change", async () => {
    const fetchMock = vi.fn(async () => res(200, { preferences: {} }));
    vi.stubGlobal("fetch", fetchMock);
    render(<Providers session={{ user: { ...testUser, role: "admin" } }}><SettingsPage onLanguageChanged={vi.fn()} /></Providers>);
    expect(screen.getByRole("switch", { name: frCA.settingsWidgetQuotesSummary })).toBeChecked();
    fireEvent.click(screen.getByRole("switch", { name: frCA.settingsWidgetQuotesLatest }));
    const patch = () => (fetchMock.mock.calls as unknown as [string, RequestInit][]).find(([url]) => url === "/api/me/preferences");
    await waitFor(() => expect(patch()).toBeDefined());
    expect(JSON.parse(String(patch()![1].body))).toEqual({ dashboard_widgets: { quotes_latest: false } });
  });

  it("does not show the quote card switches to a regular user", () => {
    vi.stubGlobal("fetch", vi.fn(async () => res(200, {})));
    render(<Providers><SettingsPage onLanguageChanged={vi.fn()} /></Providers>);
    expect(screen.queryByRole("switch", { name: frCA.settingsWidgetQuotesSummary })).toBeNull();
    expect(screen.queryByRole("switch", { name: frCA.settingsWidgetQuotesLatest })).toBeNull();
  });

  it("lets a person keep just the icons in the phone's bottom bar, and saves it to the account", async () => {
    const fetchMock = vi.fn(async () => res(200, { preferences: {} }));
    vi.stubGlobal("fetch", fetchMock);
    render(<Providers><SettingsPage onLanguageChanged={vi.fn()} /></Providers>);
    const toggle = screen.getByRole("switch", { name: frCA.settingsMenuLabels });
    expect(toggle).toBeChecked(); // names are shown until turned off
    fireEvent.click(toggle);
    expect(screen.getByRole("switch", { name: frCA.settingsMenuLabels })).not.toBeChecked();
    const patch = () => (fetchMock.mock.calls as unknown as [string, RequestInit][]).find(([url]) => url === "/api/me/preferences");
    await waitFor(() => expect(patch()).toBeDefined());
    expect(JSON.parse(String(patch()![1].body))).toEqual({ show_menu_labels: false });
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
