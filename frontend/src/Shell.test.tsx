import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import i18n from "./i18n";
import { forgetToken } from "./route";
import { openAccountMenu } from "./testUtils";
import frCA from "./locales/fr-CA.json";

const BRAND = "KMK Entretien Ménager";
const res = (status: number, body: unknown = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const user = (role = "user", username = "alice", locale = "fr-CA") => ({ id: 1, username, email: `${username}@example.com`, role, locale });
const signedIn = (role = "user", mfa = "ok", mfa_enabled = false, locale = "fr-CA") => () =>
  res(200, { user: user(role, "alice", locale), csrf_token: "tok-1", mfa, mfa_enabled });

type Handler = (init?: RequestInit) => unknown;
function mockApi(h: Record<string, Handler> = {}) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const route = `${init?.method ?? "GET"} ${url}`;
    if (route in h) return h[route](init);
    if (route === "GET /api/auth/me") return res(401, { error: "unauthenticated" });
    if (route === "GET /api/admin/users") return res(200, { users: [] });
    if (route.startsWith("GET /api/schedule/events")) return res(200, { occurrences: [] });
    if (route === "GET /api/schedule/people") return res(200, { people: [] });
    if (route === "GET /api/schedule/reminders/due") return res(200, { reminders: [] });
    throw new Error(`unexpected ${route}`);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}
const calls = (fn: ReturnType<typeof mockApi>, route: string) => fn.mock.calls.filter(([u, i]) => `${i?.method ?? "GET"} ${u}` === route);
const visit = (path: string) => window.history.pushState({}, "", path);

beforeEach(() => {
  visit("/");
  mockApi();
});
afterEach(async () => {
  cleanup();
  forgetToken();
  visit("/");
  await act(() => i18n.changeLanguage("fr-CA"));
});

describe("signed-in pages", () => {
  it("shows the dashboard with its two cards inside the shell", async () => {
    mockApi({ "GET /api/auth/me": signedIn() });
    render(<App />);
    expect(await screen.findByRole("heading", { level: 1, name: "Bonjour, alice" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: frCA.dashMyEvents })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: frCA.dashAllEvents })).toBeInTheDocument();
    expect((await screen.findAllByText(frCA.dashEmpty)).length).toBe(2);
    expect(screen.getByRole("navigation")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: frCA.language })).toBeNull(); // language lives in Settings; sign-out sits behind the account menu
    openAccountMenu();
    expect(screen.queryByRole("combobox", { name: frCA.language })).toBeNull();
    expect(screen.getByRole("button", { name: frCA.signOut })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: frCA.changePasswordTitle })).toBeNull(); // that lives on /account now
    expect(screen.queryByRole("group", { name: frCA.language })).toBeNull(); // the pre-login picker is not shown here
  });

  it("moves the two-step section and change password to /account", async () => {
    visit("/account");
    mockApi({ "GET /api/auth/me": signedIn() });
    render(<App />);
    expect(await screen.findByRole("heading", { level: 2, name: frCA.changePasswordTitle })).toBeInTheDocument();
    expect(screen.getByText(frCA.mfaStatusOff)).toBeInTheDocument();
  });

  it("marks the active entry and navigates without reloading", async () => {
    mockApi({ "GET /api/auth/me": signedIn() });
    render(<App />);
    const home = await screen.findByRole("link", { name: frCA.navDashboard });
    expect(home).toHaveAttribute("aria-current", "page");
    openAccountMenu();
    expect(screen.getByRole("link", { name: frCA.navAccount })).not.toHaveAttribute("aria-current");
    fireEvent.click(screen.getByRole("link", { name: frCA.navAccount }));
    expect(await screen.findByRole("heading", { level: 2, name: frCA.changePasswordTitle })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/account");
    expect(screen.getByRole("link", { name: frCA.navDashboard })).not.toHaveAttribute("aria-current");
    openAccountMenu();
    expect(screen.getByRole("link", { name: frCA.navAccount })).toHaveAttribute("aria-current", "page");
  });

  it("has a skip link that targets the main content", async () => {
    mockApi({ "GET /api/auth/me": signedIn() });
    const { container } = render(<App />);
    const skip = await screen.findByRole("link", { name: frCA.skipToContent });
    expect(skip).toHaveAttribute("href", "#main");
    expect(container.querySelector("main#main")).not.toBeNull();
  });

  it("shows the encouragement banner on the welcome and account pages", async () => {
    mockApi({ "GET /api/auth/me": signedIn("admin") });
    render(<App />);
    expect(await screen.findByText(frCA.mfaBannerAdmin)).toBeInTheDocument();
    openAccountMenu();
    fireEvent.click(screen.getByRole("link", { name: frCA.navAccount }));
    await screen.findByRole("heading", { level: 2, name: frCA.changePasswordTitle });
    expect(screen.getByText(frCA.mfaBannerAdmin)).toBeInTheDocument();
  });
});

describe("schedule page", () => {
  const scheduleApi = {
    "GET /api/schedule/events": () => res(200, { occurrences: [] }),
    "GET /api/schedule/people": () => res(200, { people: [] }),
  };

  it("has a Schedule entry in the navigation that opens the calendar", async () => {
    mockApi({ "GET /api/auth/me": signedIn(), ...scheduleApi });
    render(<App />);
    fireEvent.click(await screen.findByRole("link", { name: frCA.schTitle }));
    expect(await screen.findByRole("heading", { level: 1, name: frCA.schTitle })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/schedule");
    expect(screen.getByRole("link", { name: frCA.schTitle })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: frCA.navDashboard })).not.toHaveAttribute("aria-current");
  });

  it("has a Tasks entry in the navigation that opens the task list", async () => {
    mockApi({
      "GET /api/auth/me": signedIn(),
      "GET /api/tasks": () => res(200, { tasks: [] }),
      "GET /api/tasks/categories": () => res(200, { categories: [] }),
      "GET /api/schedule/people": () => res(200, { people: [] }),
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("link", { name: frCA.taskTitle }));
    expect(await screen.findByRole("heading", { level: 1, name: frCA.taskTitle })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/tasks");
    expect(screen.getByRole("link", { name: frCA.taskTitle })).toHaveAttribute("aria-current", "page");
    expect(document.title).toBe(`${frCA.taskTitle} · ${BRAND}`);
  });

  it("is reachable directly, and sets the page title", async () => {
    visit("/schedule");
    mockApi({ "GET /api/auth/me": signedIn(), ...scheduleApi });
    render(<App />);
    expect(await screen.findByRole("radio", { name: frCA.schViewsWeek })).toBeInTheDocument();
    expect(document.title).toBe(`${frCA.schTitle} · ${BRAND}`);
  });

  it("opens the new-event dialog from the Add button inside the real app", async () => {
    visit("/schedule");
    mockApi({ "GET /api/auth/me": signedIn(), ...scheduleApi });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: frCA.schAdd }));
    expect(await screen.findByRole("dialog", { name: frCA.schFormNewTitle })).toBeInTheDocument();
  });

  it("asks anonymous visitors to sign in first", async () => {
    visit("/schedule");
    render(<App />);
    expect(await screen.findByRole("heading", { level: 1, name: frCA.signInTitle })).toBeInTheDocument();
  });
});

describe("account menu", () => {
  it("holds the account page and sign out, and closes on Escape", async () => {
    mockApi({ "GET /api/auth/me": signedIn() });
    render(<App />);
    await screen.findByRole("link", { name: frCA.navDashboard });
    const button = openAccountMenu();
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: frCA.navAccount })).toHaveAttribute("href", "/account");
    expect(screen.getByRole("button", { name: frCA.signOut })).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("button", { name: frCA.signOut })).toBeNull();
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("closes after choosing the account page", async () => {
    mockApi({ "GET /api/auth/me": signedIn() });
    render(<App />);
    await screen.findByRole("link", { name: frCA.navDashboard });
    openAccountMenu();
    fireEvent.click(screen.getByRole("link", { name: frCA.navAccount }));
    await screen.findByRole("heading", { level: 2, name: frCA.changePasswordTitle });
    expect(screen.queryByRole("button", { name: frCA.signOut })).toBeNull();
  });
});

describe("navigation by role", () => {
  it.each([
    ["user", false],
    ["admin", true],
    ["superadmin", true],
  ])("%s sees Users: %s", async (role, sees) => {
    mockApi({ "GET /api/auth/me": signedIn(role) });
    render(<App />);
    await screen.findByRole("link", { name: frCA.navDashboard });
    expect(!!screen.queryByRole("link", { name: frCA.navUsers })).toBe(sees);
  });

  it.each([
    ["user", false],
    ["admin", false],
    ["superadmin", true],
  ])("%s sees Devices: %s", async (role, sees) => {
    mockApi({ "GET /api/auth/me": signedIn(role) });
    render(<App />);
    await screen.findByRole("link", { name: frCA.navDashboard });
    expect(!!screen.queryByRole("link", { name: frCA.navDevices })).toBe(sees);
  });

  it.each(["user", "admin", "superadmin"])("%s sees Documents", async (role) => {
    mockApi({ "GET /api/auth/me": signedIn(role) });
    render(<App />);
    expect(await screen.findByRole("link", { name: frCA.navDocuments })).toBeInTheDocument();
  });

  it("reaches About from the account menu", async () => {
    mockApi({ "GET /api/auth/me": signedIn("user"), "GET /api/version": () => res(200, { version: "0.2.9", commit: "abc1234", built_at: null }) });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(frCA.accountMenu) }));
    fireEvent.click(screen.getByRole("link", { name: frCA.navAbout }));
    expect(await screen.findByRole("heading", { level: 1, name: frCA.navAbout })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/about");
  });

  it("sends an admin who types /devices to the Dashboard", async () => {
    visit("/devices");
    mockApi({ "GET /api/auth/me": signedIn("admin") });
    render(<App />);
    await screen.findByRole("link", { name: frCA.navDashboard });
    expect(screen.queryByRole("heading", { name: frCA.deviceTitle })).toBeNull();
  });

  it("opens the admin page for an admin from the nav", async () => {
    const fn = mockApi({ "GET /api/auth/me": signedIn("admin") });
    render(<App />);
    fireEvent.click(await screen.findByRole("link", { name: frCA.navUsers }));
    expect(await screen.findByRole("heading", { level: 1, name: frCA.adminTitle })).toBeInTheDocument();
    expect(calls(fn, "GET /api/admin/users")).toHaveLength(1);
    expect(screen.getByRole("link", { name: frCA.navUsers })).toHaveAttribute("aria-current", "page");
  });

  it("shows a plain user the welcome page at /admin, without any admin request", async () => {
    visit("/admin");
    const fn = mockApi({ "GET /api/auth/me": signedIn("user") });
    render(<App />);
    expect(await screen.findByRole("heading", { level: 1, name: "Bonjour, alice" })).toBeInTheDocument();
    expect(calls(fn, "GET /api/admin/users")).toHaveLength(0);
  });
});

describe("visitors who are not signed in", () => {
  it.each(["/", "/account", "/admin"])("see the sign-in form at %s, with the language picker", async (path) => {
    visit(path);
    render(<App />);
    expect(await screen.findByRole("heading", { level: 1, name: frCA.signInTitle })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: frCA.language })).toBeInTheDocument();
  });

  it("get the requested page after signing in", async () => {
    visit("/account");
    mockApi({ "POST /api/auth/login": signedIn() });
    render(<App />);
    await screen.findByLabelText(frCA.identifier);
    fireEvent.change(screen.getByLabelText(frCA.identifier), { target: { value: "alice" } });
    fireEvent.change(screen.getByLabelText(frCA.password), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: frCA.signIn }));
    expect(await screen.findByRole("heading", { level: 2, name: frCA.changePasswordTitle })).toBeInTheDocument();
  });

  it("see the language picker on the forgot-password and set-password pages too", async () => {
    visit("/forgot-password");
    const first = render(<App />);
    await screen.findByRole("heading", { level: 1, name: frCA.forgotTitle });
    expect(screen.getByRole("group", { name: frCA.language })).toBeInTheDocument();
    first.unmount();
    visit("/set-password#token=abc");
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: frCA.setPasswordTitle });
    expect(screen.getByRole("group", { name: frCA.language })).toBeInTheDocument();
  });
});

describe("unknown pages", () => {
  it("show a friendly page to anonymous visitors", async () => {
    visit("/nope");
    render(<App />);
    expect(await screen.findByRole("heading", { level: 1, name: frCA.notFoundTitle })).toBeInTheDocument();
    expect(screen.getByText(frCA.notFoundText)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: frCA.notFoundHome })).toBeInTheDocument();
  });

  it("show it inside the shell to signed-in users, with a link home", async () => {
    visit("/nope");
    mockApi({ "GET /api/auth/me": signedIn() });
    render(<App />);
    expect(await screen.findByRole("heading", { level: 1, name: frCA.notFoundTitle })).toBeInTheDocument();
    expect(screen.getByRole("navigation")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: frCA.notFoundHome }));
    expect(await screen.findByRole("heading", { level: 1, name: "Bonjour, alice" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
  });
});

describe("two-step states take over every path", () => {
  it("shows the code screen for a session that still has to verify", async () => {
    visit("/account");
    mockApi({ "GET /api/auth/me": signedIn("user", "verify", true) });
    render(<App />);
    expect(await screen.findByRole("heading", { level: 1, name: frCA.mfaCodeTitle })).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("shows the enrollment screen when it is required", async () => {
    mockApi({
      "GET /api/auth/me": signedIn("admin", "setup", false),
      "POST /api/auth/mfa/setup": () => res(200, { secret: "JBSWY3DPEHPK3PXP", otpauth_uri: "otpauth://totp/x?secret=JBSWY3DPEHPK3PXP" }),
    });
    render(<App />);
    expect(await screen.findByRole("heading", { level: 1, name: frCA.mfaSetupTitle })).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).toBeNull();
  });
});

describe("titles and language", () => {
  const titleAt = async (path: string, handlers: Record<string, Handler>) => {
    visit(path);
    mockApi(handlers);
    render(<App />);
    await waitFor(() => expect(document.title).not.toBe(BRAND));
    return document.title;
  };

  it("sets the page title from the page name", async () => {
    expect(await titleAt("/", { "GET /api/auth/me": signedIn() })).toBe(`${frCA.navDashboard} · ${BRAND}`);
    cleanup();
    expect(await titleAt("/account", { "GET /api/auth/me": signedIn() })).toBe(`${frCA.navAccount} · ${BRAND}`);
    cleanup();
    expect(await titleAt("/admin", { "GET /api/auth/me": signedIn("admin") })).toBe(`${frCA.adminTitle} · ${BRAND}`);
    cleanup();
    expect(await titleAt("/", {})).toBe(`${frCA.signInTitle} · ${BRAND}`);
    cleanup();
    expect(await titleAt("/nope", {})).toBe(`${frCA.notFoundTitle} · ${BRAND}`);
  });

  it("applies the user's language at sign-in, saves it for the login page, and sets <html lang>", async () => {
    mockApi({ "POST /api/auth/login": signedIn("user", "ok", false, "en") });
    render(<App />);
    await screen.findByLabelText(frCA.identifier);
    fireEvent.change(screen.getByLabelText(frCA.identifier), { target: { value: "alice" } });
    fireEvent.change(screen.getByLabelText(frCA.password), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: frCA.signIn }));
    expect(await screen.findByRole("heading", { level: 1, name: "Hello, alice" })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en");
    expect(window.localStorage.getItem("kmk.lang")).toBe("en");
  });

  it("applies the language of an existing session on load too", async () => {
    mockApi({ "GET /api/auth/me": signedIn("user", "ok", false, "pt-BR") });
    render(<App />);
    expect(await screen.findByRole("heading", { level: 1, name: "Olá, alice" })).toBeInTheDocument();
    expect(window.localStorage.getItem("kmk.lang")).toBe("pt-BR");
  });
});

describe("signing out", () => {
  it("forgets what the previous person's pages had loaded (no reminder of theirs for the next sign-in)", async () => {
    const reminder = { event_id: 1, occurrence_date: "2026-11-05", title: "Alice private visit", start_date: "2026-11-05", start_time: "09:00", all_day: false, remind_at: "2026-11-05T07:00" };
    let reminders: unknown[] = [reminder];
    mockApi({
      "GET /api/auth/me": signedIn(),
      "POST /api/auth/logout": () => res(204),
      "POST /api/auth/login": signedIn(),
      "GET /api/schedule/reminders/due": () => (reminders.length ? res(200, { reminders }) : new Promise(() => {})), // the next person's answer is slow
    });
    render(<App />);
    expect(await screen.findByText("Alice private visit")).toBeInTheDocument();
    openAccountMenu();
    fireEvent.click(await screen.findByRole("button", { name: frCA.signOut }));
    await screen.findByLabelText(frCA.identifier);
    reminders = [];
    fireEvent.change(screen.getByLabelText(frCA.identifier), { target: { value: "bob" } });
    fireEvent.change(screen.getByLabelText(frCA.password), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: frCA.signIn }));
    await screen.findByRole("heading", { level: 1, name: "Bonjour, alice" });
    expect(screen.queryByText("Alice private visit")).toBeNull();
  });
});

describe("reminders", () => {
  it("shows a due reminder on every signed-in page", async () => {
    visit("/account");
    mockApi({
      "GET /api/auth/me": signedIn(),
      "GET /api/schedule/reminders/due": () =>
        res(200, { reminders: [{ event_id: 1, occurrence_date: "2026-11-05", title: "Visit client", start_date: "2026-11-05", start_time: "09:00", all_day: false, remind_at: "2026-11-05T07:00" }] }),
    });
    render(<App />);
    expect(await screen.findByText("Visit client")).toBeInTheDocument();
  });
});
