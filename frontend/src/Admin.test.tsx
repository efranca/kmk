import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import i18n from "./i18n";
import { forgetToken } from "./route";
import frCA from "./locales/fr-CA.json";

const res = (status: number, body: unknown = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const me = (role: string, mfa_enabled = true) => () =>
  res(200, { user: { id: 1, username: "me", email: "me@example.com", role, locale: "fr-CA" }, csrf_token: "tok-1", mfa: "ok", mfa_enabled });

type AdminRow = ReturnType<typeof row>;
const row = (o: Record<string, unknown>) => ({
  id: 10,
  username: "alice",
  email: "alice@example.com",
  role: "user",
  locale: "fr-CA",
  status: "active",
  mfa_enabled: false,
  created_at: "2026-01-01T00:00:00Z",
  last_sign_in: null as string | null,
  actions: ["view"],
  ...o,
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
const listOf = (users: AdminRow[]) => () => res(200, { users });
const calls = (fn: ReturnType<typeof mockApi>, route: string) => fn.mock.calls.filter(([u, i]) => `${i?.method ?? "GET"} ${u}` === route);
const bodyOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string);
const headersOf = (call: unknown[]) => (call[1] as RequestInit).headers as Record<string, string>;
const tab = (status: string) => fireEvent.click(screen.getByRole("radio", { name: new RegExp(`^${frCA[`status_${status}` as keyof typeof frCA]} \\d+$`) }));
const rowOf = (name: string) => screen.getByRole("article", { name });
const click = (scope: { getByRole: typeof screen.getByRole }, name: string) => fireEvent.click(scope.getByRole("button", { name }));
/** Taps a person's row and returns queries scoped to the dialog that opens. */
const openUser = (name: string) => {
  fireEvent.click(within(rowOf(name)).getByRole("button"));
  return within(screen.getByRole("dialog"));
};

async function openAdmin(users: AdminRow[], role = "admin", extra: Record<string, Handler> = {}) {
  window.history.pushState({}, "", "/admin");
  const fn = mockApi({ "GET /api/auth/me": me(role), "GET /api/admin/users": listOf(users), ...extra });
  render(<App />);
  await screen.findByRole("heading", { level: 1, name: frCA.adminTitle });
  await screen.findByRole("article", { name: users[0].username });
  return fn;
}

beforeEach(() => {
  window.history.pushState({}, "", "/");
  mockApi({});
});
afterEach(async () => {
  cleanup();
  forgetToken();
  window.history.pushState({}, "", "/");
  await act(() => i18n.changeLanguage("fr-CA"));
});

describe("reaching the page", () => {
  it("is linked from the navigation for admins and opens the list", async () => {
    const fn = mockApi({ "GET /api/auth/me": me("admin"), "GET /api/admin/users": listOf([row({})]) });
    render(<App />);
    fireEvent.click(await screen.findByRole("link", { name: frCA.navUsers }));
    expect(await screen.findByRole("heading", { level: 1, name: frCA.adminTitle })).toBeInTheDocument();
    expect(calls(fn, "GET /api/admin/users")).toHaveLength(1);
  });

  it("shows plain users the ordinary page, without a link or any admin request", async () => {
    window.history.pushState({}, "", "/admin");
    const fn = mockApi({ "GET /api/auth/me": me("user") });
    render(<App />);
    expect(await screen.findByRole("heading", { level: 1, name: "Bonjour, me" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: frCA.navUsers })).toBeNull();
    expect(calls(fn, "GET /api/admin/users")).toHaveLength(0);
  });

  it("shows the login form to an anonymous visitor", async () => {
    window.history.pushState({}, "", "/admin");
    render(<App />);
    expect(await screen.findByRole("heading", { level: 1, name: frCA.signInTitle })).toBeInTheDocument();
  });
});

describe("the list", () => {
  const users = [
    row({ id: 10, username: "alice", last_sign_in: "2026-03-01T12:00:00Z", mfa_enabled: true }),
    row({ id: 11, username: "marc", email: "marc@example.com", role: "admin", status: "invited" }),
    row({ id: 12, username: "gone", email: "gone@example.com", status: "deleted" }),
  ];

  it("shows the role, notes an account that is not active, and flags admins without two-step", async () => {
    await openAdmin(users);
    const alice = within(rowOf("alice"));
    expect(alice.getByText(frCA.role_user)).toBeInTheDocument();
    expect(alice.queryByText(frCA.status_active)).toBeNull(); // nothing to say about a normal account
    expect(alice.queryByText(frCA.adminAdminNoMfa)).toBeNull();
    tab("invited");
    const marc = within(rowOf("marc"));
    expect(marc.getByText(frCA.role_admin)).toBeInTheDocument();
    expect(marc.getByText(frCA.status_invited)).toBeInTheDocument();
    expect(marc.getByText(frCA.adminAdminNoMfa)).toBeInTheDocument();
  });

  it("shows the two-step state and last sign-in in the person's dialog", async () => {
    await openAdmin(users);
    const alice = openUser("alice");
    expect(alice.getByText(frCA.adminMfaOn)).toBeInTheDocument();
    expect(alice.getByText(new RegExp(frCA.adminLastSignIn))).not.toHaveTextContent(frCA.adminNever);
    fireEvent.click(alice.getByRole("button", { name: "Fermer" }));
    tab("invited");
    expect(openUser("marc").getByText(new RegExp(`${frCA.adminLastSignIn}: ${frCA.adminNever}`))).toBeInTheDocument();
  });

  it("shows active accounts first, and the other statuses under their own tab (like the task tabs)", async () => {
    await openAdmin(users);
    expect(screen.getByRole("article", { name: "alice" })).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: "gone" })).toBeNull();
    expect(screen.queryByRole("article", { name: "marc" })).toBeNull();
    tab("deleted");
    expect(screen.getByRole("article", { name: "gone" })).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: "alice" })).toBeNull();
    tab("invited");
    expect(screen.getByRole("article", { name: "marc" })).toBeInTheDocument();
  });

  it("puts a count on each tab", async () => {
    await openAdmin(users);
    for (const status of ["active", "invited", "disabled", "deleted"]) {
      expect(screen.getByRole("radio", { name: new RegExp(`^${frCA[`status_${status}` as keyof typeof frCA]} \\d+$`) })).toBeInTheDocument();
    }
  });

  it("searches by name or email through every status, and the tabs step aside", async () => {
    await openAdmin(users);
    fireEvent.click(screen.getByRole("button", { name: frCA.adminSearch }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "MARC@" } });
    expect(screen.getByRole("article", { name: "marc" })).toBeInTheDocument(); // invited, found without opening its tab
    expect(screen.queryByRole("article", { name: "alice" })).toBeNull();
    expect(screen.queryByRole("radio", { name: new RegExp(frCA.status_active) })).toBeNull();
  });
});

describe("buttons come only from the server's list of actions", () => {
  it("renders exactly the listed actions", async () => {
    await openAdmin(
      [
        row({ id: 10, username: "alice", actions: ["view"] }),
        row({ id: 11, username: "bob", actions: ["view", "edit", "reset_password", "disable", "set_role"] }),
        row({ id: 12, username: "carl", role: "admin", actions: ["view", "set_role", "restore"] }),
      ],
      "superadmin",
    );
    const alice = openUser("alice");
    expect(alice.queryAllByRole("button").map((b) => b.textContent)).toEqual([""]); // only the dialog's close button
    fireEvent.click(alice.getByRole("button"));
    const bob = openUser("bob");
    for (const k of ["act_edit", "act_reset_password", "act_disable", "act_make_admin"] as const) {
      expect(bob.getByRole("button", { name: frCA[k] })).toBeInTheDocument();
    }
    expect(bob.queryByRole("button", { name: frCA.act_delete })).toBeNull();
    fireEvent.click(bob.getByRole("button", { name: "Fermer" }));
    const carl = openUser("carl");
    expect(carl.getByRole("button", { name: frCA.act_make_user })).toBeInTheDocument();
    expect(carl.getByRole("button", { name: frCA.act_restore })).toBeInTheDocument();
    expect(carl.queryByRole("button", { name: frCA.act_make_admin })).toBeNull();
  });
});

describe("actions", () => {
  const bob = row({ id: 11, username: "bob", actions: ["view", "disable", "enable", "delete", "reset_mfa", "set_role", "restore", "resend_invite"] });

  it("asks for a confirmation before disabling, then reloads", async () => {
    const fn = await openAdmin([bob], "admin", { "POST /api/admin/users/11/disable": () => res(200, { status: "ok" }) });
    let dialog = openUser("bob");
    click(dialog, frCA.act_disable);
    expect(calls(fn, "POST /api/admin/users/11/disable")).toHaveLength(0);
    click(dialog, frCA.adminCancel);
    expect(calls(fn, "POST /api/admin/users/11/disable")).toHaveLength(0);
    click(dialog, frCA.act_disable);
    click(dialog, frCA.confirm);
    expect(await screen.findByText(frCA.adminDone)).toBeInTheDocument();
    const call = calls(fn, "POST /api/admin/users/11/disable")[0];
    expect(headersOf(call)["X-CSRF-Token"]).toBe("tok-1");
    expect(calls(fn, "GET /api/admin/users")).toHaveLength(2); // reloaded
    expect(screen.queryByRole("dialog")).toBeNull(); // and the dialog closed
    dialog = openUser("bob");
    expect(dialog.getByRole("button", { name: frCA.act_disable })).toBeInTheDocument();
  });

  it("confirms delete, two-step reset and role change too, and sends enable, restore and resend at once", async () => {
    const ok = () => res(200, { status: "ok" });
    const fn = await openAdmin([bob], "superadmin", {
      "POST /api/admin/users/11/delete": ok,
      "POST /api/admin/users/11/reset-mfa": ok,
      "POST /api/admin/users/11/role": () => res(200, { user: {} }),
      "POST /api/admin/users/11/enable": ok,
      "POST /api/admin/users/11/restore": ok,
      "POST /api/admin/users/11/invite": () => res(202, { status: "ok" }),
    });
    for (const [label, route] of [
      [frCA.act_delete, "POST /api/admin/users/11/delete"],
      [frCA.act_reset_mfa, "POST /api/admin/users/11/reset-mfa"],
      [frCA.act_make_admin, "POST /api/admin/users/11/role"],
    ] as const) {
      const dialog = openUser("bob");
      click(dialog, label);
      expect(calls(fn, route)).toHaveLength(0);
      click(dialog, frCA.confirm);
      await waitFor(() => expect(calls(fn, route)).toHaveLength(1));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    }
    expect(bodyOf(calls(fn, "POST /api/admin/users/11/role")[0])).toEqual({ role: "admin" });
    for (const [label, route] of [
      [frCA.act_enable, "POST /api/admin/users/11/enable"],
      [frCA.act_restore, "POST /api/admin/users/11/restore"],
      [frCA.act_resend_invite, "POST /api/admin/users/11/invite"],
    ] as const) {
      click(openUser("bob"), label);
      await waitFor(() => expect(calls(fn, route)).toHaveLength(1));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    }
  });

  it.each([
    [403, { error: "forbidden" }, "errForbidden"],
    [403, { error: "cannot_target_self" }, "errSelf"],
    [409, { error: "invalid_state" }, "errInvalidState"],
    [409, { error: "last_admin" }, "errLastAdmin"],
  ] as const)("explains a %s %j inside the dialog, which stays open", async (status, body, key) => {
    await openAdmin([bob], "admin", { "POST /api/admin/users/11/enable": () => res(status, body) });
    click(openUser("bob"), frCA.act_enable);
    expect(await within(screen.getByRole("dialog")).findByText(frCA[key])).toBeInTheDocument();
  });

  it("shows a network error when the request fails", async () => {
    await openAdmin([bob], "admin", {
      "POST /api/admin/users/11/enable": () => {
        throw new Error("offline");
      },
    });
    click(openUser("bob"), frCA.act_enable);
    expect(await screen.findByText(frCA.networkError)).toBeInTheDocument();
  });

  it("lets an admin take down someone's picture, only when there is one", async () => {
    const withPicture = row({ id: 11, username: "bob", avatar_url: "/api/people/11/avatar?v=1", actions: ["view", "edit"] });
    const none = row({ id: 12, username: "zed", avatar_url: null, actions: ["view", "edit"] });
    const fn = await openAdmin([withPicture, none], "admin", { "DELETE /api/admin/users/11/avatar": () => res(204) });
    expect(openUser("zed").queryByRole("button", { name: frCA.avatarRemove })).toBeNull();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Fermer" }));
    click(openUser("bob"), frCA.avatarRemove);
    await waitFor(() => expect(calls(fn, "DELETE /api/admin/users/11/avatar")).toHaveLength(1));
    expect(headersOf(calls(fn, "DELETE /api/admin/users/11/avatar")[0])["X-CSRF-Token"]).toBe("tok-1");
  });
});

describe("editing", () => {
  it("sends the language, and the email only for an invited account", async () => {
    const fn = await openAdmin(
      [row({ id: 10, username: "alice", actions: ["view", "edit"] }), row({ id: 11, username: "inv", status: "invited", actions: ["view", "edit"] })],
      "admin",
      { "PATCH /api/admin/users/10": () => res(200, { user: {} }), "PATCH /api/admin/users/11": () => res(200, { user: {} }) },
    );
    const alice = openUser("alice");
    click(alice, frCA.act_edit);
    expect(alice.queryByLabelText(frCA.adminEmail)).toBeNull();
    fireEvent.change(alice.getByLabelText(frCA.adminLanguage), { target: { value: "en" } });
    click(alice, frCA.adminSave);
    await waitFor(() => expect(calls(fn, "PATCH /api/admin/users/10")).toHaveLength(1));
    expect(bodyOf(calls(fn, "PATCH /api/admin/users/10")[0])).toEqual({ locale: "en" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    tab("invited");
    const inv = openUser("inv");
    click(inv, frCA.act_edit);
    fireEvent.change(inv.getByLabelText(frCA.adminEmail), { target: { value: "fixed@example.com" } });
    click(inv, frCA.adminSave);
    await waitFor(() => expect(calls(fn, "PATCH /api/admin/users/11")).toHaveLength(1));
    expect(bodyOf(calls(fn, "PATCH /api/admin/users/11")[0])).toMatchObject({ email: "fixed@example.com" });
  });
});

describe("inviting", () => {
  const plus = () => fireEvent.click(screen.getByRole("button", { name: frCA.adminInviteTitle }));
  const fill = () => {
    fireEvent.change(screen.getByLabelText(frCA.adminName), { target: { value: "Nadia Newbie" } });
    fireEvent.change(screen.getByLabelText(frCA.adminUsername), { target: { value: "newbie" } });
    fireEvent.change(screen.getByLabelText(frCA.adminEmail), { target: { value: "newbie@example.com" } });
    fireEvent.change(screen.getByLabelText(frCA.adminLanguage), { target: { value: "pt-BR" } });
  };
  const submit = () => fireEvent.click(screen.getByRole("button", { name: frCA.adminInviteSend }));

  it("opens from the plus button", async () => {
    await openAdmin([row({})]);
    expect(screen.queryByRole("dialog")).toBeNull();
    plus();
    expect(screen.getByRole("dialog", { name: frCA.adminInviteTitle })).toBeInTheDocument();
  });

  it("always invites a plain user when the viewer is an admin (no role choice), then reloads and closes", async () => {
    const fn = await openAdmin([row({})], "admin", { "POST /api/admin/users": () => res(201, { user: {}, email_queued: true }) });
    plus();
    expect(screen.queryByLabelText(frCA.adminRole)).toBeNull();
    fill();
    submit();
    expect(await screen.findByText(frCA.adminInviteSent)).toBeInTheDocument();
    expect(bodyOf(calls(fn, "POST /api/admin/users")[0])).toEqual({ name: "Nadia Newbie", username: "newbie", email: "newbie@example.com", locale: "pt-BR", role: "user" });
    expect(calls(fn, "GET /api/admin/users")).toHaveLength(2);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("lets the super admin choose the role", async () => {
    const fn = await openAdmin([row({})], "superadmin", { "POST /api/admin/users": () => res(201, { user: {}, email_queued: true }) });
    plus();
    fill();
    fireEvent.change(screen.getByLabelText(frCA.adminRole), { target: { value: "admin" } });
    submit();
    await screen.findByText(frCA.adminInviteSent);
    expect(bodyOf(calls(fn, "POST /api/admin/users")[0]).role).toBe("admin");
  });

  it("explains a duplicate and keeps the form open", async () => {
    await openAdmin([row({})], "admin", { "POST /api/admin/users": () => res(409, { error: "already_exists" }) });
    plus();
    fill();
    submit();
    expect(await within(screen.getByRole("dialog")).findByText(frCA.errExists)).toBeInTheDocument();
  });
});
