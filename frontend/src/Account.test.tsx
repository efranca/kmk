import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import i18n from "./i18n";
import { forgetToken } from "./route";
import frCA from "./locales/fr-CA.json";

const alice = { id: 1, username: "alice", email: "alice@example.com", role: "user", locale: "fr-CA" };
const res = (status: number, body: unknown = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

type Handler = (init?: RequestInit) => unknown;
function mockApi(h: Record<string, Handler> = {}) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const route = `${init?.method ?? "GET"} ${url}`;
    if (route in h) return h[route](init);
    if (route === "GET /api/auth/me") return res(401, { error: "unauthenticated" });
    throw new Error(`unexpected ${route}`);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}
const calls = (fn: ReturnType<typeof mockApi>, route: string) =>
  fn.mock.calls.filter(([u, i]) => `${i?.method ?? "GET"} ${u}` === route);
const bodyOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string);
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  window.history.pushState({}, "", "/");
  mockApi();
});
afterEach(async () => {
  cleanup();
  forgetToken();
  window.history.pushState({}, "", "/");
  await act(() => i18n.changeLanguage("fr-CA"));
});

describe("forgot password", () => {
  async function openForm() {
    render(<App />);
    fireEvent.click(await screen.findByRole("link", { name: frCA.forgotPasswordLink }));
    await screen.findByRole("heading", { level: 1, name: frCA.forgotTitle });
  }

  it("always shows the same confirmation message", async () => {
    const fn = mockApi({ "POST /api/auth/forgot-password": () => res(202, { status: "ok" }) });
    await openForm();
    type(frCA.identifier, "ghost");
    fireEvent.click(screen.getByRole("button", { name: frCA.send }));
    expect(await screen.findByText(frCA.forgotDone)).toBeInTheDocument();
    expect(bodyOf(calls(fn, "POST /api/auth/forgot-password")[0])).toEqual({ identifier: "ghost" });
  });

  it("shows a network error and the rate-limit message", async () => {
    mockApi({
      "POST /api/auth/forgot-password": () => {
        throw new Error("offline");
      },
    });
    await openForm();
    type(frCA.identifier, "a");
    fireEvent.click(screen.getByRole("button", { name: frCA.send }));
    expect(await screen.findByText(frCA.networkError)).toBeInTheDocument();
    mockApi({ "POST /api/auth/forgot-password": () => res(429) });
    fireEvent.click(screen.getByRole("button", { name: frCA.send }));
    expect(await screen.findByText(frCA.tooManyAttempts)).toBeInTheDocument();
  });
});

describe("set password", () => {
  function open(token = "abc") {
    window.history.pushState({}, "", token ? `/set-password#token=${token}` : "/set-password");
    render(<App />);
  }
  const submit = () => fireEvent.click(screen.getByRole("button", { name: frCA.savePassword }));

  it("posts the token from the fragment and removes it from the address bar", async () => {
    const fn = mockApi({ "POST /api/auth/set-password": () => res(200, { status: "ok" }) });
    open();
    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe("/set-password");
    type(frCA.newPassword, "Newpass1!");
    type(frCA.confirmPassword, "Newpass1!");
    submit();
    expect(await screen.findByText(frCA.setPasswordDone)).toBeInTheDocument();
    expect(bodyOf(calls(fn, "POST /api/auth/set-password")[0])).toEqual({ token: "abc", password: "Newpass1!" });
    expect(screen.getByRole("link", { name: frCA.backToSignIn })).toBeInTheDocument();
  });

  it("shows the invalid-link message for a 400 and the weak-password message for a 422", async () => {
    mockApi({ "POST /api/auth/set-password": () => res(400, { error: "invalid_token" }) });
    open();
    type(frCA.newPassword, "Newpass1!");
    type(frCA.confirmPassword, "Newpass1!");
    submit();
    expect(await screen.findByText(frCA.invalidLink)).toBeInTheDocument();
    cleanup();
    forgetToken();
    mockApi({ "POST /api/auth/set-password": () => res(422, { error: "weak_password", rules: ["too_short"] }) });
    open();
    type(frCA.newPassword, "short");
    type(frCA.confirmPassword, "short");
    submit();
    expect(await screen.findByText(frCA.weakPassword)).toBeInTheDocument();
  });

  it("refuses mismatched confirmation without calling the API", async () => {
    const fn = mockApi();
    open();
    type(frCA.newPassword, "Newpass1!");
    type(frCA.confirmPassword, "Different1!");
    submit();
    expect(await screen.findByText(frCA.passwordsDontMatch)).toBeInTheDocument();
    expect(calls(fn, "POST /api/auth/set-password")).toHaveLength(0);
  });

  it("shows the invalid-link message straight away when there is no token", () => {
    open("");
    expect(screen.getByText(frCA.invalidLink)).toBeInTheDocument();
    expect(screen.queryByLabelText(frCA.newPassword)).toBeNull();
  });
});

describe("change password", () => {
  const signedIn = { "GET /api/auth/me": () => res(200, { user: alice, csrf_token: "tok-9" }) };
  async function open(extra: Record<string, Handler>) {
    const fn = mockApi({ ...signedIn, ...extra });
    render(<App />);
    await screen.findByRole("heading", { level: 2, name: frCA.changePasswordTitle });
    type(frCA.currentPassword, "Oldpass1!");
    type(frCA.newPassword, "Newpass1!");
    fireEvent.click(screen.getByRole("button", { name: frCA.changePassword }));
    return fn;
  }

  it("sends the CSRF token and both passwords, then confirms", async () => {
    const fn = await open({ "POST /api/auth/change-password": () => res(200, { status: "ok" }) });
    expect(await screen.findByText(frCA.passwordChanged)).toBeInTheDocument();
    const call = calls(fn, "POST /api/auth/change-password")[0];
    expect((call[1] as RequestInit).headers).toMatchObject({ "X-CSRF-Token": "tok-9" });
    expect(bodyOf(call)).toEqual({ current_password: "Oldpass1!", new_password: "Newpass1!" });
  });

  it("explains a wrong current password, the same password and a weak one", async () => {
    await open({ "POST /api/auth/change-password": () => res(403, { error: "invalid_current_password" }) });
    expect(await screen.findByText(frCA.wrongCurrentPassword)).toBeInTheDocument();
    cleanup();
    await open({ "POST /api/auth/change-password": () => res(422, { error: "same_password" }) });
    expect(await screen.findByText(frCA.samePassword)).toBeInTheDocument();
    cleanup();
    await open({ "POST /api/auth/change-password": () => res(422, { error: "weak_password", rules: [] }) });
    expect(await screen.findByText(frCA.weakPassword)).toBeInTheDocument();
  });
});
