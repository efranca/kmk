import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders, resetLanguage, testUser, useEnglish } from "../testUtils";
import { NotificationsCard } from "./NotificationsCard";

const push = vi.hoisted(() => ({
  pushSupported: vi.fn(() => true),
  currentSubscription: vi.fn(async () => null as unknown),
  enablePush: vi.fn(async () => "on" as const),
  disablePush: vi.fn(async () => undefined),
  testPush: vi.fn(async () => 1),
}));
vi.mock("../push", () => push);

const admin = { ...testUser, role: "admin" as const };

beforeEach(async () => {
  await useEnglish();
  push.pushSupported.mockReturnValue(true);
  push.currentSubscription.mockResolvedValue(null);
});
afterEach(async () => { vi.clearAllMocks(); vi.restoreAllMocks(); vi.unstubAllGlobals(); Reflect.deleteProperty(navigator, "standalone"); await resetLanguage(); });

describe("NotificationsCard", () => {
  it("gives plain users the email switch but not push", () => {
    renderWithProviders(<NotificationsCard />, { session: { user: testUser } });
    expect(screen.getByRole("switch", { name: "Email me when I am added to a Schedule event" })).toBeChecked();
    expect(screen.queryByText(/on this device/)).toBeNull();
  });

  it("says so when the browser cannot show notifications", async () => {
    push.pushSupported.mockReturnValue(false);
    renderWithProviders(<NotificationsCard />, { session: { user: admin } });
    expect(await screen.findByText("This browser cannot show notifications.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Turn on notifications" })).toBeNull();
  });

  it("turns notifications on for this device", async () => {
    renderWithProviders(<NotificationsCard />, { session: { user: admin } });
    expect(await screen.findByText("Notifications are off for this device.")).toBeInTheDocument();
    push.currentSubscription.mockResolvedValue({ endpoint: "x" });
    fireEvent.click(screen.getByRole("button", { name: "Turn on notifications" }));
    await waitFor(() => expect(push.enablePush).toHaveBeenCalledWith("tok-1"));
    expect(await screen.findByText("Notifications are on for this device.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send a test" })).toBeInTheDocument();
  });

  it("explains a refusal in the browser", async () => {
    push.enablePush.mockResolvedValueOnce("denied" as never);
    renderWithProviders(<NotificationsCard />, { session: { user: admin } });
    fireEvent.click(await screen.findByRole("button", { name: "Turn on notifications" }));
    expect(await screen.findByText(/blocked in this browser/)).toBeInTheDocument();
  });

  it("tells iPhone users to add the app to the Home Screen first", async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)");
    Object.defineProperty(navigator, "standalone", { configurable: true, value: false });
    renderWithProviders(<NotificationsCard />, { session: { user: admin } });
    expect(await screen.findByText(/add the app to the Home Screen/)).toBeInTheDocument();
  });
});
