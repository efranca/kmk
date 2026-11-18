import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import i18n from "./i18n";
import { displayName, fold } from "./person";
import { forgetToken } from "./route";
import enJson from "./locales/en.json";
import frCA from "./locales/fr-CA.json";
import ptBR from "./locales/pt-BR.json";

const res = (status: number, body: unknown = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const me = (user: Record<string, unknown>) => () => res(200, { user, csrf_token: "tok-1", mfa: "ok", mfa_enabled: true });
const person = (o: Record<string, unknown> = {}) => ({ id: 1, username: "alice", email: "alice@example.com", role: "user", locale: "fr-CA", ...o });
const row = (o: Record<string, unknown> = {}) => ({
  id: 10, username: "alice", name: null, email: "alice@example.com", role: "user", locale: "fr-CA", status: "active",
  mfa_enabled: false, created_at: "2026-01-01T00:00:00Z", last_sign_in: null, actions: ["view"], ...o,
});

type Handler = (init?: RequestInit) => unknown;
function mockApi(h: Record<string, Handler>) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const route = `${init?.method ?? "GET"} ${url}`;
    if (route in h) return h[route](init);
    if (route === "GET /api/auth/me") return res(401, { error: "unauthenticated" });
    throw new Error(`unexpected ${route}`);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}
const calls = (fn: ReturnType<typeof mockApi>, route: string) => fn.mock.calls.filter(([u, i]) => `${i?.method ?? "GET"} ${u}` === route);
const bodyOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string);
const visit = (path: string) => window.history.pushState({}, "", path);

beforeEach(() => {
  visit("/");
});
afterEach(async () => {
  cleanup();
  forgetToken();
  visit("/");
  await act(() => i18n.changeLanguage("fr-CA"));
});

describe("person helpers", () => {
  it("displayName prefers the name and falls back to the username", () => {
    expect(displayName({ name: "Marie Tremblay", username: "marie" })).toBe("Marie Tremblay");
    expect(displayName({ name: null, username: "marie" })).toBe("marie");
    expect(displayName({ username: "marie" })).toBe("marie");
    expect(displayName({ name: "   ", username: "marie" })).toBe("marie");
  });

  it("fold ignores accents, capitals and extra spaces", () => {
    expect(fold("Élise")).toBe("elise");
    expect(fold("ÉLISE  Gagnon ")).toBe("elise gagnon");
    expect(fold("Zoë")).toBe("zoe");
  });

  it("the new strings exist in every language", () => {
    for (const f of [frCA, enJson, ptBR]) {
      expect(f.adminName).toBeTruthy();
      expect(f.errInvalidInput).toBeTruthy();
    }
  });
});

describe("greeting and account page", () => {
  it("greet by name when there is one, by username otherwise", async () => {
    mockApi({ "GET /api/auth/me": me(person({ name: "Marie Tremblay" })) });
    render(<App />);
    expect(await screen.findByRole("heading", { level: 1, name: "Bonjour, Marie Tremblay" })).toBeInTheDocument();
    cleanup();
    mockApi({ "GET /api/auth/me": me(person()) });
    render(<App />);
    expect(await screen.findByRole("heading", { level: 1, name: "Bonjour, alice" })).toBeInTheDocument();
  });

  it("shows 'name · username' on the account page, just the username without a name", async () => {
    visit("/account");
    mockApi({ "GET /api/auth/me": me(person({ name: "Marie Tremblay" })) });
    render(<App />);
    expect(await screen.findByText(/Marie Tremblay · alice/)).toBeInTheDocument();
    cleanup();
    mockApi({ "GET /api/auth/me": me(person()) });
    render(<App />);
    expect(await screen.findByRole("heading", { level: 1, name: frCA.navAccount })).toBeInTheDocument();
    expect(screen.queryByText(/ · alice/)).toBeNull();
    expect(screen.getByText(new RegExp(`alice · ${frCA.roleLabel}`))).toBeInTheDocument();
  });
});

describe("admin list", () => {
  const admin = person({ id: 2, username: "boss", role: "admin" });
  const users = [
    row({ id: 10, username: "egagnon", name: "Élise Gagnon", email: "e.g@example.com" }),
    row({ id: 11, username: "bob", name: null, email: "bob@example.com" }),
    row({ id: 12, username: "mt", name: "Marie Tremblay", email: "marie@example.com", actions: ["view", "edit"] }),
  ];

  async function open(extra: Record<string, Handler> = {}) {
    visit("/admin");
    const fn = mockApi({ "GET /api/auth/me": me(admin), "GET /api/admin/users": () => res(200, { users: users }), ...extra });
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: frCA.adminTitle });
    await screen.findByRole("article", { name: "Élise Gagnon" });
    return fn;
  }

  it("shows the name first with the username and email beneath; people without a name keep their username", async () => {
    await open();
    const elise = within(screen.getByRole("article", { name: "Élise Gagnon" }));
    expect(elise.getByText("Élise Gagnon")).toBeInTheDocument();
    expect(elise.getByText("egagnon · e.g@example.com")).toBeInTheDocument();
    const bob = within(screen.getByRole("article", { name: "bob" }));
    expect(bob.getByText("bob")).toBeInTheDocument();
    expect(bob.getByText("bob@example.com")).toBeInTheDocument();
  });

  it.each(["elise", "ÉLISE", "gagnon", "egagnon", "e.g@example"])("finds the person when searching for %s", async (needle) => {
    await open();
    fireEvent.change(screen.getByLabelText(frCA.adminSearch), { target: { value: needle } });
    expect(screen.getByRole("article", { name: "Élise Gagnon" })).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: "bob" })).toBeNull();
  });

  it("edits a name and sends only what changed", async () => {
    const fn = await open({ "PATCH /api/admin/users/12": () => res(200, { user: {} }) });
    const marie = within(screen.getByRole("article", { name: "Marie Tremblay" }));
    fireEvent.click(marie.getByRole("button", { name: frCA.act_edit }));
    const field = marie.getByLabelText(frCA.adminName) as HTMLInputElement;
    expect(field.value).toBe("Marie Tremblay"); // prefilled
    fireEvent.change(field, { target: { value: "Marie Tremblay-Roy" } });
    fireEvent.click(marie.getByRole("button", { name: frCA.adminSave }));
    await waitFor(() => expect(calls(fn, "PATCH /api/admin/users/12")).toHaveLength(1));
    expect(bodyOf(calls(fn, "PATCH /api/admin/users/12")[0])).toEqual({ name: "Marie Tremblay-Roy" });
  });

  it("explains an invalid name returned by the server", async () => {
    await open({ "PATCH /api/admin/users/12": () => res(422, { detail: [] }) });
    const marie = within(screen.getByRole("article", { name: "Marie Tremblay" }));
    fireEvent.click(marie.getByRole("button", { name: frCA.act_edit }));
    fireEvent.change(marie.getByLabelText(frCA.adminName), { target: { value: "Bad <name>" } });
    fireEvent.click(marie.getByRole("button", { name: frCA.adminSave }));
    expect(await screen.findByText(frCA.errInvalidInput)).toBeInTheDocument();
  });

  it("lets the super admin edit their own row (the server lists the action)", async () => {
    visit("/admin");
    const root = person({ id: 1, username: "root", name: "Rita Root", role: "superadmin" });
    const fn = mockApi({
      "GET /api/auth/me": me(root),
      "GET /api/admin/users": () => res(200, { users: [row({ id: 1, username: "root", name: "Rita Root", role: "superadmin", actions: ["view", "edit", "reset_password"] })] }),
      "PATCH /api/admin/users/1": () => res(200, { user: {} }),
    });
    render(<App />);
    const own = within(await screen.findByRole("article", { name: "Rita Root" }));
    fireEvent.click(own.getByRole("button", { name: frCA.act_edit }));
    fireEvent.change(own.getByLabelText(frCA.adminName), { target: { value: "Rita R. Root" } });
    fireEvent.click(own.getByRole("button", { name: frCA.adminSave }));
    await waitFor(() => expect(calls(fn, "PATCH /api/admin/users/1")).toHaveLength(1));
  });
});

describe("inviting needs a name", () => {
  it("has a required, 100-character name field and shows the server's refusal", async () => {
    visit("/admin");
    mockApi({
      "GET /api/auth/me": me(person({ id: 2, username: "boss", role: "admin" })),
      "GET /api/admin/users": () => res(200, { users: [row()] }),
      "POST /api/admin/users": () => res(422, { detail: [] }),
    });
    render(<App />);
    await screen.findByRole("article", { name: "alice" });
    const field = screen.getByLabelText(frCA.adminName) as HTMLInputElement;
    expect(field).toBeRequired();
    expect(field.maxLength).toBe(100);
    expect(field).toHaveAttribute("autocomplete", "name");
    fireEvent.change(field, { target: { value: "Bad <name>" } });
    fireEvent.change(screen.getByLabelText(frCA.adminUsername), { target: { value: "newbie" } });
    fireEvent.change(screen.getByLabelText(frCA.adminEmail), { target: { value: "newbie@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: frCA.adminInviteSend }));
    expect(await screen.findByText(frCA.errInvalidInput)).toBeInTheDocument();
  });
});
