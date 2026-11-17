import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import i18n from "./i18n";
import { forgetToken } from "./route";
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
  it("shows the welcome page inside the shell", async () => {
    mockApi({ "GET /api/auth/me": signedIn() });
    render(<App />);
    expect(await screen.findByRole("heading", { level: 1, name: "Bonjour, alice" })).toBeInTheDocument();
    expect(screen.getByText(frCA.welcomeTitle)).toBeInTheDocument();
    expect(screen.getByText(frCA.welcomeIntro)).toBeInTheDocument();
    expect(screen.getByRole("navigation")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: frCA.language })).toBeInTheDocument();
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
    const home = await screen.findByRole("link", { name: frCA.navWelcome });
    expect(home).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("link", { name: frCA.navAccount }));
    expect(await screen.findByRole("heading", { level: 2, name: frCA.changePasswordTitle })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/account");
    expect(screen.getByRole("link", { name: frCA.navAccount })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: frCA.navWelcome })).not.toHaveAttribute("aria-current");
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
    fireEvent.click(screen.getByRole("link", { name: frCA.navAccount }));
    await screen.findByRole("heading", { level: 2, name: frCA.changePasswordTitle });
    expect(screen.getByText(frCA.mfaBannerAdmin)).toBeInTheDocument();
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
    await screen.findByRole("link", { name: frCA.navWelcome });
    expect(!!screen.queryByRole("link", { name: frCA.navUsers })).toBe(sees);
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
    expect(await titleAt("/", { "GET /api/auth/me": signedIn() })).toBe(`${frCA.navWelcome} · ${BRAND}`);
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
