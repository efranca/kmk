import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("qrcode", () => {
  const toDataURL = vi.fn(async () => "data:image/png;base64,AAAA");
  return { default: { toDataURL }, toDataURL };
});

import App from "./App";
import i18n from "./i18n";
import frCA from "./locales/fr-CA.json";

const alice = { id: 1, username: "alice", email: "alice@example.com", role: "user", locale: "fr-CA" };
const boss = { ...alice, id: 2, username: "boss", role: "admin" };
const res = (status: number, body: unknown = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const session = (user = alice, mfa = "ok", mfa_enabled = false) => () => res(200, { user, csrf_token: "tok-1", mfa, mfa_enabled });

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
const calls = (fn: ReturnType<typeof mockApi>, route: string) =>
  fn.mock.calls.filter(([u, i]) => `${i?.method ?? "GET"} ${u}` === route);
const bodyOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string);
const headersOf = (call: unknown[]) => (call[1] as RequestInit).headers as Record<string, string>;
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

const CODES = Array.from({ length: 10 }, (_, i) => `abcd${i}-efgh${i}`);

const visitAccount = () => window.history.pushState({}, "", "/account"); // the security section lives there

beforeEach(() => {
  window.history.pushState({}, "", "/");
  window.localStorage.clear();
  mockApi({});
});
afterEach(async () => {
  cleanup();
  window.history.pushState({}, "", "/");
  window.localStorage.clear();
  await act(() => i18n.changeLanguage("fr-CA"));
});

describe("two-step login", () => {
  async function signInReachingVerify(extra: Record<string, Handler> = {}) {
    const fn = mockApi({
      "POST /api/auth/login": () => res(200, { user: alice, csrf_token: "t1", mfa: "verify", mfa_enabled: true }),
      ...extra,
    });
    render(<App />);
    await screen.findByLabelText(frCA.identifier);
    type(frCA.identifier, "alice");
    type(frCA.password, "pw");
    click(frCA.signIn);
    await screen.findByRole("heading", { level: 1, name: frCA.mfaCodeTitle });
    return fn;
  }

  it("asks for the code after the password and then opens the signed-in page", async () => {
    const fn = await signInReachingVerify({
      "POST /api/auth/mfa/verify": () => res(200, { status: "ok", recovery_codes_remaining: 10 }),
    });
    type(frCA.mfaCode, "654321");
    click(frCA.mfaVerify);
    expect(await screen.findByRole("heading", { level: 1, name: "Bonjour, alice" })).toBeInTheDocument();
    const call = calls(fn, "POST /api/auth/mfa/verify")[0];
    expect(bodyOf(call)).toEqual({ code: "654321" });
    expect(headersOf(call)["X-CSRF-Token"]).toBe("t1");
  });

  it("shows an error for a wrong code", async () => {
    await signInReachingVerify({ "POST /api/auth/mfa/verify": () => res(403, { error: "invalid_code" }) });
    type(frCA.mfaCode, "000000");
    click(frCA.mfaVerify);
    expect(await screen.findByText(frCA.invalidCode)).toBeInTheDocument();
  });

  it("accepts a recovery code and warns when few are left", async () => {
    const fn = await signInReachingVerify({
      "POST /api/auth/mfa/verify": () => res(200, { status: "ok", recovery_codes_remaining: 2 }),
    });
    click(frCA.useRecoveryCode);
    type(frCA.recoveryCode, "abcde-fghjk");
    click(frCA.mfaVerify);
    await screen.findByRole("heading", { level: 1, name: "Bonjour, alice" });
    expect(bodyOf(calls(fn, "POST /api/auth/mfa/verify")[0])).toEqual({ recovery_code: "abcde-fghjk" });
    expect(screen.getByText(/2/, { selector: ".notice" })).toBeInTheDocument();
  });
});

describe("encouragement banner", () => {
  it("lets a regular user dismiss it, and remembers that", async () => {
    mockApi({ "GET /api/auth/me": session() });
    const first = render(<App />);
    expect(await screen.findByText(frCA.mfaBannerUser)).toBeInTheDocument();
    click(frCA.dismiss);
    expect(screen.queryByText(frCA.mfaBannerUser)).toBeNull();
    first.unmount();
    render(<App />);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByText(frCA.mfaBannerUser)).toBeNull();
  });

  it("keeps the banner for admins, with no dismiss button", async () => {
    mockApi({ "GET /api/auth/me": session(boss) });
    render(<App />);
    expect(await screen.findByText(frCA.mfaBannerAdmin)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: frCA.dismiss })).toBeNull();
  });

  it("shows no banner once two-step verification is on", async () => {
    visitAccount();
    mockApi({ "GET /api/auth/me": session(boss, "ok", true) });
    render(<App />);
    await screen.findByText(frCA.mfaStatusOn);
    expect(screen.queryByText(frCA.mfaBannerAdmin)).toBeNull();
  });
});

describe("enrollment", () => {
  const enrollmentApi = {
    "POST /api/auth/mfa/setup": () => res(200, { secret: "JBSWY3DPEHPK3PXP", otpauth_uri: "otpauth://totp/KMK:alice?secret=JBSWY3DPEHPK3PXP" }),
    "POST /api/auth/mfa/enable": () => res(200, { recovery_codes: CODES }),
  };

  it("shows the QR code and secret, then the recovery codes, then the signed-in page", async () => {
    visitAccount();
    const fn = mockApi({ "GET /api/auth/me": session(), ...enrollmentApi });
    render(<App />);
    await screen.findByRole("button", { name: frCA.mfaSetupTitle });
    click(frCA.mfaSetupTitle);
    expect(await screen.findByText("JBSWY3DPEHPK3PXP")).toBeInTheDocument();
    expect(screen.getByAltText(frCA.mfaQrAlt)).toHaveAttribute("src", "data:image/png;base64,AAAA");
    expect(headersOf(calls(fn, "POST /api/auth/mfa/setup")[0])["X-CSRF-Token"]).toBe("tok-1");

    type(frCA.mfaCode, "123456");
    click(frCA.mfaEnable);
    expect(await screen.findByText(CODES[0])).toBeInTheDocument();
    expect(bodyOf(calls(fn, "POST /api/auth/mfa/enable")[0])).toEqual({ code: "123456" });
    expect(screen.getByRole("button", { name: frCA.continue })).toBeDisabled();
    fireEvent.click(screen.getByLabelText(frCA.savedCodes));
    expect(screen.getByRole("button", { name: frCA.continue })).toBeEnabled();
    click(frCA.continue);

    expect(await screen.findByText(frCA.mfaStatusOn)).toBeInTheDocument();
    expect(screen.queryByText(frCA.mfaBannerUser)).toBeNull();
  });

  it("goes straight to enrollment when the server requires it, with no way to skip", async () => {
    const fn = mockApi({ "GET /api/auth/me": session(boss, "setup", false), ...enrollmentApi });
    render(<App />);
    expect(await screen.findByText("JBSWY3DPEHPK3PXP")).toBeInTheDocument();
    expect(calls(fn, "POST /api/auth/mfa/setup")).toHaveLength(1);
    expect(screen.queryByText(frCA.welcome.replace("{{name}}", "boss"))).toBeNull();
    expect(screen.getByRole("button", { name: frCA.signOut })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: frCA.dismiss })).toBeNull();
  });

  it("explains when two-step verification is unavailable", async () => {
    visitAccount();
    mockApi({ "GET /api/auth/me": session(), "POST /api/auth/mfa/setup": () => res(503, { error: "mfa_unavailable" }) });
    render(<App />);
    await screen.findByRole("button", { name: frCA.mfaSetupTitle });
    click(frCA.mfaSetupTitle);
    expect(await screen.findByText(frCA.mfaUnavailable)).toBeInTheDocument();
  });
});

describe("security section", () => {
  const enabled = { "GET /api/auth/me": session(alice, "ok", true) };

  async function open(extra: Record<string, Handler>) {
    visitAccount();
    const fn = mockApi({ ...enabled, ...extra });
    render(<App />);
    await screen.findByText(frCA.mfaStatusOn);
    return fn;
  }
  const fillConfirm = () => {
    type(frCA.password, "pw");
    type(frCA.mfaCode, "123456");
    click(frCA.confirm);
  };

  it("regenerates recovery codes with the password and a code", async () => {
    const fn = await open({ "POST /api/auth/mfa/recovery-codes/regenerate": () => res(200, { recovery_codes: CODES }) });
    click(frCA.regenerateCodes);
    fillConfirm();
    expect(await screen.findByText(CODES[3])).toBeInTheDocument();
    const call = calls(fn, "POST /api/auth/mfa/recovery-codes/regenerate")[0];
    expect(bodyOf(call)).toEqual({ password: "pw", code: "123456" });
    expect(headersOf(call)["X-CSRF-Token"]).toBe("tok-1");
  });

  it("disables two-step verification", async () => {
    const fn = await open({ "POST /api/auth/mfa/disable": () => res(200, { status: "ok" }) });
    click(frCA.disableMfa);
    fillConfirm();
    expect(await screen.findByText(frCA.mfaStatusOff)).toBeInTheDocument();
    expect(bodyOf(calls(fn, "POST /api/auth/mfa/disable")[0])).toEqual({ password: "pw", code: "123456" });
  });

  it("explains when it is mandatory, and for a wrong password or code", async () => {
    await open({ "POST /api/auth/mfa/disable": () => res(403, { error: "mfa_mandatory" }) });
    click(frCA.disableMfa);
    fillConfirm();
    expect(await screen.findByText(frCA.mfaMandatory)).toBeInTheDocument();
    cleanup();
    await open({ "POST /api/auth/mfa/disable": () => res(403, { error: "invalid_current_password" }) });
    click(frCA.disableMfa);
    fillConfirm();
    expect(await screen.findByText(frCA.wrongCurrentPassword)).toBeInTheDocument();
    cleanup();
    await open({ "POST /api/auth/mfa/disable": () => res(403, { error: "invalid_code" }) });
    click(frCA.disableMfa);
    fillConfirm();
    expect(await screen.findByText(frCA.invalidCode)).toBeInTheDocument();
  });
});
