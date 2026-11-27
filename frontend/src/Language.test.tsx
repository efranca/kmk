import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import i18n from "./i18n";
import LanguagePicker from "./LanguagePicker";
import LanguageSwitcher from "./LanguageSwitcher";
import { initialLanguage, isLang, rememberLanguage, savedLanguage } from "./lang";
import enJson from "./locales/en.json";
import frCA from "./locales/fr-CA.json";
import ptBR from "./locales/pt-BR.json";
import es from "./locales/es.json";
import { consumeToken, forgetToken, linkLanguage } from "./route";

const res = (status: number, body: unknown = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const alice = { id: 1, username: "alice", email: "alice@example.com", role: "user", locale: "fr-CA" };

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

beforeEach(() => {
  window.history.pushState({}, "", "/");
  mockApi({});
});
afterEach(async () => {
  cleanup();
  forgetToken();
  vi.restoreAllMocks();
  window.history.pushState({}, "", "/");
  await act(() => i18n.changeLanguage("fr-CA"));
});

describe("language helpers", () => {
  it("accepts only the four languages", () => {
    expect(["fr-CA", "en", "pt-BR", "es"].every(isLang)).toBe(true);
    expect([isLang("de"), isLang(""), isLang(null), isLang(undefined), isLang(3)]).toEqual([false, false, false, false, false]);
  });

  it("starts in French, or in the saved language when valid", () => {
    expect(initialLanguage()).toBe("fr-CA");
    rememberLanguage("pt-BR");
    expect(savedLanguage()).toBe("pt-BR");
    expect(initialLanguage()).toBe("pt-BR");
    window.localStorage.setItem("kmk.lang", "klingon");
    expect(initialLanguage()).toBe("fr-CA");
  });

  it("does not break when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(initialLanguage()).toBe("fr-CA");
    expect(() => rememberLanguage("en")).not.toThrow();
  });
});

describe("pre-login picker", () => {
  it("switches the interface, remembers the choice and shows which language is active", async () => {
    render(<LanguagePicker />);
    expect(screen.getByRole("button", { name: "FR" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "EN" }));
    await waitFor(() => expect(i18n.language).toBe("en"));
    expect(window.localStorage.getItem("kmk.lang")).toBe("en");
    expect(screen.getByRole("button", { name: "EN" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "FR" })).toHaveAttribute("aria-pressed", "false");
  });
});

describe("signed-in switcher", () => {
  it("saves the language on the server and then switches the interface", async () => {
    const onChanged = vi.fn();
    const fn = mockApi({ "POST /api/auth/locale": () => res(200, { user: { ...alice, locale: "pt-BR" } }) });
    render(<LanguageSwitcher csrfToken="tok-1" onChanged={onChanged} />);
    fireEvent.change(screen.getByLabelText(frCA.language), { target: { value: "pt-BR" } });
    await waitFor(() => expect(i18n.language).toBe("pt-BR"));
    const call = calls(fn, "POST /api/auth/locale")[0];
    expect(bodyOf(call)).toEqual({ locale: "pt-BR" });
    expect((call[1] as RequestInit).headers).toMatchObject({ "X-CSRF-Token": "tok-1" });
    expect(window.localStorage.getItem("kmk.lang")).toBe("pt-BR");
    expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ locale: "pt-BR" }));
  });

  it.each([
    ["a server error", () => res(500)],
    ["a refusal", () => res(403, { error: "mfa_required" })],
    [
      "a network failure",
      () => {
        throw new Error("offline");
      },
    ],
  ])("keeps the previous language and says so after %s", async (_name, handler) => {
    mockApi({ "POST /api/auth/locale": handler });
    render(<LanguageSwitcher csrfToken="tok-1" onChanged={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(frCA.language), { target: { value: "en" } });
    expect(await screen.findByText(frCA.langError)).toBeInTheDocument();
    expect(i18n.language).toBe("fr-CA");
    expect(window.localStorage.getItem("kmk.lang")).toBeNull();
  });
});

describe("language in emailed links", () => {
  it("reads the token and the language, then removes the fragment", () => {
    window.history.pushState({}, "", "/set-password#token=abc&lang=pt-BR");
    expect(consumeToken()).toBe("abc");
    expect(linkLanguage()).toBe("pt-BR");
    expect(window.location.hash).toBe("");
    forgetToken();
    expect(linkLanguage()).toBeNull();
  });

  it.each(["#token=abc&lang=de", "#token=abc", "#lang=en&token=abc"])("treats %s safely", (hash) => {
    window.history.pushState({}, "", `/set-password${hash}`);
    expect(consumeToken()).toBe("abc");
    expect(linkLanguage()).toBe(hash.includes("lang=en") ? "en" : null);
  });

  it("opens the set-password page in the link's language and still posts the token", async () => {
    window.history.pushState({}, "", "/set-password#token=abc&lang=pt-BR");
    const fn = mockApi({ "POST /api/auth/set-password": () => res(200, { status: "ok" }) });
    render(<App />);
    expect(await screen.findByRole("heading", { level: 1, name: ptBR.setPasswordTitle })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(ptBR.newPassword), { target: { value: "Newpass1!" } });
    fireEvent.change(screen.getByLabelText(ptBR.confirmPassword), { target: { value: "Newpass1!" } });
    fireEvent.click(screen.getByRole("button", { name: ptBR.savePassword }));
    await screen.findByText(ptBR.setPasswordDone);
    expect(bodyOf(calls(fn, "POST /api/auth/set-password")[0])).toEqual({ token: "abc", password: "Newpass1!" });
    expect(window.localStorage.getItem("kmk.lang")).toBeNull(); // a visit-only language, not a saved preference
  });

  it("ignores an unknown link language", async () => {
    window.history.pushState({}, "", "/set-password#token=abc&lang=de");
    render(<App />);
    expect(await screen.findByRole("heading", { level: 1, name: frCA.setPasswordTitle })).toBeInTheDocument();
  });
});

describe("locale files", () => {
  it("define the language labels in every language", () => {
    for (const f of [frCA, enJson, ptBR, es]) {
      expect(f.language).toBeTruthy();
      expect(f.langError).toBeTruthy();
    }
  });
});

describe("Spanish", () => {
  it("is available for the app, with plural forms, and can be remembered", async () => {
    await act(() => i18n.changeLanguage("es"));
    expect(i18n.t("schReminderHours", { count: 1 })).toBe("1 hora");
    expect(i18n.t("schReminderHours", { count: 3 })).toBe("3 horas");
    expect(i18n.t("signInTitle")).toBe("Iniciar sesión");
    expect(window.localStorage.getItem("kmk.lang")).toBeNull();
    rememberLanguage("es");
    expect(initialLanguage()).toBe("es");
  });
});
