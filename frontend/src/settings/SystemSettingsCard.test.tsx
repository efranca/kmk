import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockApi, renderWithProviders, resetLanguage, testUser, useEnglish } from "../testUtils";
import { SystemSettingsCard } from "./SystemSettingsCard";

const boss = { ...testUser, role: "superadmin" as const };
const VALUES = { quote_notify_email: "team@gmail.com", quote_from: "KMK <devis@mail.example>", quote_reply_to: "kmk@gmail.com", public_phone: "(418) 555-0100" };

beforeEach(async () => { await useEnglish(); });
afterEach(async () => { vi.unstubAllGlobals(); await resetLanguage(); });

describe("SystemSettingsCard", () => {
  it("is for the super admin only", () => {
    const { calls } = mockApi({});
    renderWithProviders(<SystemSettingsCard />, { session: { user: { ...testUser, role: "admin" } } });
    expect(screen.queryByText("Company settings")).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("shows the four settings and saves them", async () => {
    const { calls } = mockApi({ "GET /api/settings/system": { settings: VALUES }, "PATCH /api/settings/system": { settings: { ...VALUES, public_phone: "(418) 555-0199" } } });
    renderWithProviders(<SystemSettingsCard />, { session: { user: boss } });
    expect(await screen.findByLabelText("New quote notification email")).toHaveValue("team@gmail.com");
    expect(screen.getByLabelText("Quote sender (From)")).toHaveValue("KMK <devis@mail.example>");
    expect(screen.getByLabelText("Reply-To address")).toHaveValue("kmk@gmail.com");
    fireEvent.change(screen.getByLabelText("Public phone number"), { target: { value: "(418) 555-0199" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ ...VALUES, public_phone: "(418) 555-0199" }));
    expect(await screen.findByText("Settings saved")).toBeInTheDocument();
  });

  it("says a value is not valid when the server refuses it", async () => {
    mockApi({
      "GET /api/settings/system": { settings: VALUES },
      "PATCH /api/settings/system": { ok: false, status: 422, json: async () => ({ error: "invalid" }) },
    });
    renderWithProviders(<SystemSettingsCard />, { session: { user: boss } });
    fireEvent.change(await screen.findByLabelText("Reply-To address"), { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/not valid/)).toBeInTheDocument();
  });
});
