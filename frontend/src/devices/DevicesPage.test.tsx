import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "../i18n";
import en from "../locales/en.json";
import { renderWithProviders } from "../testUtils";
import DevicesPage from "./DevicesPage";

const res = (status: number, body: unknown = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const NOW = new Date().toISOString();

const data = {
  users: [
    {
      user: { id: 1, name: "Alice Roy", username: "alice", role: "superadmin", avatar_url: null },
      sessions: [{ id: "s-own", user_agent: CHROME, created_at: NOW, last_seen_at: NOW, ip: "8.8.8.8", country: "CA", city: "Montréal", current: true }],
    },
    {
      user: { id: 2, name: "Bob Tremblay", username: "bob", role: "user", avatar_url: null },
      sessions: [
        { id: "s-b1", user_agent: SAFARI, created_at: NOW, last_seen_at: NOW, ip: "192.168.1.20", country: null, city: null, current: false },
        { id: "s-b2", user_agent: CHROME, created_at: NOW, last_seen_at: NOW, ip: "203.0.113.7", country: null, city: null, current: false },
      ],
    },
  ],
};

let fetchMock: ReturnType<typeof vi.fn>;
function mockApi(list: () => unknown = () => res(200, data)) {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const route = `${init?.method ?? "GET"} ${url}`;
    if (route === "GET /api/admin/devices") return list();
    if (route.startsWith("DELETE /api/admin/devices/") || route.endsWith("/devices/logout-all")) return res(204);
    throw new Error(`unexpected ${route}`);
  });
  vi.stubGlobal("fetch", fetchMock);
}
const called = (route: string) => fetchMock.mock.calls.some(([url, init]) => `${(init as RequestInit | undefined)?.method ?? "GET"} ${url}` === route);

beforeEach(async () => {
  await act(() => i18n.changeLanguage("en"));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Devices page", () => {
  it("groups the sessions by person and marks this device", async () => {
    mockApi();
    renderWithProviders(<DevicesPage />);
    const alice = await screen.findByRole("region", { name: /Alice Roy/ });
    expect(within(alice).getByText(en.deviceThisDevice)).toBeInTheDocument();
    expect(within(alice).getByText("Chrome · Windows")).toBeInTheDocument();
    const bob = screen.getByRole("region", { name: /Bob Tremblay/ });
    expect(within(bob).getAllByRole("listitem")).toHaveLength(2);
    expect(within(bob).getByText("Safari · iOS")).toBeInTheDocument();
  });

  it("shows the place with a flag, or says local network or unknown", async () => {
    mockApi();
    renderWithProviders(<DevicesPage />);
    expect(await screen.findByText(/Montréal/)).toBeInTheDocument();
    expect(screen.getByText(en.deviceLocalNetwork)).toBeInTheDocument();
    expect(screen.getByText(en.deviceLocationUnknown)).toBeInTheDocument();
  });

  it("says that signing out does not block anyone", async () => {
    mockApi();
    renderWithProviders(<DevicesPage />);
    expect(await screen.findByText(en.deviceNote)).toBeInTheDocument();
  });

  it("asks before ending one device, and does nothing on cancel", async () => {
    mockApi();
    renderWithProviders(<DevicesPage />);
    const bob = await screen.findByRole("region", { name: /Bob Tremblay/ });
    fireEvent.click(within(bob).getAllByRole("button", { name: en.deviceSignOut })[0]);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: en.cancel }));
    expect(called("DELETE /api/admin/devices/s-b1")).toBe(false);

    fireEvent.click(within(bob).getAllByRole("button", { name: en.deviceSignOut })[0]);
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: en.confirm }));
    await waitFor(() => expect(called("DELETE /api/admin/devices/s-b1")).toBe(true));
  });

  it("ends all of a person's devices after a confirmation", async () => {
    mockApi();
    renderWithProviders(<DevicesPage />);
    const bob = await screen.findByRole("region", { name: /Bob Tremblay/ });
    fireEvent.click(within(bob).getByRole("button", { name: en.deviceSignOutAll }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: en.confirm }));
    await waitFor(() => expect(called("POST /api/admin/users/2/devices/logout-all")).toBe(true));
  });

  it("tells when the list cannot be loaded", async () => {
    mockApi(() => res(500, { error: "x" }));
    renderWithProviders(<DevicesPage />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
