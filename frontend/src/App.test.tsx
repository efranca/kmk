import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import i18n from "./i18n";
import en from "./locales/en.json";
import frCA from "./locales/fr-CA.json";
import ptBR from "./locales/pt-BR.json";
import { openAccountMenu } from "./testUtils";

const alice = { id: 1, username: "alice", email: "alice@example.com", role: "admin", locale: "fr-CA" };
const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

type Handler = (init?: RequestInit) => unknown;
function mockApi(h: { me?: Handler; login?: Handler; logout?: Handler }) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const route = `${init?.method ?? "GET"} ${url}`;
    if (route === "GET /api/auth/me") return (h.me ?? (() => json(401, { error: "unauthenticated" })))(init);
    if (route === "POST /api/auth/login") return (h.login ?? (() => json(401, {})))(init);
    if (route === "POST /api/auth/logout") return (h.logout ?? (() => ({ ok: true, status: 204 })))(init);
    throw new Error(`unexpected ${route}`);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function fillAndSubmit(identifier = "alice", password = "pw") {
  fireEvent.change(screen.getByLabelText(frCA.identifier), { target: { value: identifier } });
  fireEvent.change(screen.getByLabelText(frCA.password), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: frCA.signIn }));
}

beforeEach(() => {
  mockApi({});
});
afterEach(async () => {
  cleanup();
  await act(() => i18n.changeLanguage("fr-CA"));
});

describe("App", () => {
  it("shows the login form when there is no session", async () => {
    render(<App />);
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Connexion");
    expect(screen.getByLabelText(frCA.password)).toHaveAttribute("type", "password");
  });

  it("offers French and English on the sign-in page, not Portuguese", async () => {
    render(<App />);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByRole("button", { name: "FR" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "EN" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "PT" })).toBeNull();
  });

  it("lets the person see what they type in the password field", async () => {
    render(<App />);
    const password = await screen.findByLabelText(frCA.password);
    fireEvent.click(screen.getByRole("button", { name: frCA.showPassword }));
    expect(password).toHaveAttribute("type", "text");
    fireEvent.click(screen.getByRole("button", { name: frCA.hidePassword }));
    expect(password).toHaveAttribute("type", "password");
  });

  it("signs in and switches to the user's language", async () => {
    mockApi({ login: () => json(200, { user: { ...alice, locale: "en" }, csrf_token: "tok" }) });
    render(<App />);
    await screen.findByLabelText(frCA.identifier);
    fillAndSubmit();
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Hello, alice"));
    openAccountMenu();
    expect(screen.getByRole("button", { name: en.signOut })).toBeInTheDocument();
  });

  it.each([
    [401, frCA.invalidCredentials],
    [429, frCA.tooManyAttempts],
  ])("shows the right message for a %s", async (status, message) => {
    mockApi({ login: () => json(status, {}) });
    render(<App />);
    await screen.findByLabelText(frCA.identifier);
    fillAndSubmit();
    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it("shows a network error when the request fails", async () => {
    mockApi({
      login: () => {
        throw new Error("offline");
      },
    });
    render(<App />);
    await screen.findByLabelText(frCA.identifier);
    fillAndSubmit();
    expect(await screen.findByText(frCA.networkError)).toBeInTheDocument();
  });

  it("goes straight to the signed-in page when a session exists", async () => {
    mockApi({ me: () => json(200, { user: alice, csrf_token: "tok" }) });
    render(<App />);
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Bonjour, alice");
    openAccountMenu();
    fireEvent.click(screen.getByRole("link", { name: frCA.navAccount })); // the role line is on the account page
    expect(await screen.findByText(new RegExp(frCA.role_admin))).toBeInTheDocument();
  });

  it("logs out with the CSRF token and returns to the form", async () => {
    const fn = mockApi({ me: () => json(200, { user: alice, csrf_token: "tok-123" }) });
    render(<App />);
    await screen.findByRole("link", { name: frCA.navDashboard });
    openAccountMenu();
    fireEvent.click(await screen.findByRole("button", { name: frCA.signOut }));
    await waitFor(() => expect(screen.getByLabelText(frCA.identifier)).toBeInTheDocument());
    const call = fn.mock.calls.find(([u, i]) => u === "/api/auth/logout" && i?.method === "POST")!;
    expect((call[1]!.headers as Record<string, string>)["X-CSRF-Token"]).toBe("tok-123");
  });

  it("all locale files define the same keys", () => {
    const keys = (o: object) => Object.keys(o).sort();
    expect(keys(en)).toEqual(keys(frCA));
    expect(keys(ptBR)).toEqual(keys(frCA));
  });
});
