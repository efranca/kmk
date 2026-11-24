import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockApi, renderWithProviders, resetLanguage, testUser, useEnglish } from "../testUtils";
import { CategoryManager } from "./CategoryManager";

const admin = { user: { ...testUser, role: "admin" as const } };
let cats: { id: number; name: string; icon: string | null }[];

function api(extra: Record<string, unknown> = {}) {
  return mockApi({ "GET /api/tasks/categories": () => ({ categories: cats }), ...extra });
}

beforeEach(async () => {
  await useEnglish();
  cats = [{ id: 1, name: "Office", icon: "🏢" }, { id: 2, name: "Shop", icon: null }];
});
afterEach(async () => { vi.unstubAllGlobals(); await resetLanguage(); });

describe("CategoryManager", () => {
  it("lets anyone add a category, with an icon suggested from the name", async () => {
    const { calls } = api({ "POST /api/tasks/categories": { category: { id: 9, name: "Windows", icon: "🪟" } } });
    renderWithProviders(<CategoryManager onClose={() => {}} />);
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Windows" } });
    expect(screen.getByRole("button", { name: "Icon" })).toHaveTextContent("🪟");
    fireEvent.click(screen.getByRole("button", { name: "Add category" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ name: "Windows", icon: "🪟" });
  });

  it("a new category with no matching icon gets the default task icon", async () => {
    const { calls } = api({ "POST /api/tasks/categories": { category: { id: 9, name: "Zzqx", icon: "✅" } } });
    renderWithProviders(<CategoryManager onClose={() => {}} />);
    expect(await screen.findByRole("button", { name: "Icon" })).toHaveTextContent("✅"); // shown before typing anything
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Zzqx" } });
    expect(screen.getByRole("button", { name: "Icon" })).toHaveTextContent("✅");
    fireEvent.click(screen.getByRole("button", { name: "Add category" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ name: "Zzqx", icon: "✅" });
  });

  it("a plain user cannot rename or delete", async () => {
    api();
    renderWithProviders(<CategoryManager onClose={() => {}} />);
    expect(await screen.findByText("Office")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Edit/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Delete/ })).not.toBeInTheDocument();
  });

  it("an admin renames a category and changes its icon", async () => {
    const { calls } = api({ "PATCH /api/tasks/categories/2": { category: { id: 2, name: "Supplies", icon: "📦" } } });
    renderWithProviders(<CategoryManager onClose={() => {}} />, { session: admin });
    fireEvent.click(await screen.findByRole("button", { name: "Edit Shop" }));
    const row = screen.getByRole("listitem", { name: "Shop" });
    fireEvent.change(within(row).getByLabelText("Name"), { target: { value: "Supplies" } });
    fireEvent.click(within(row).getByRole("button", { name: "Icon" }));
    fireEvent.click(within(row).getByRole("button", { name: "📦" }));
    fireEvent.click(within(row).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ name: "Supplies", icon: "📦" });
  });

  it("an admin deletes a category only after confirming, and its tasks are kept", async () => {
    const { calls } = api({ "DELETE /api/tasks/categories/1": { ok: true, status: 204, json: async () => ({}) } });
    renderWithProviders(<CategoryManager onClose={() => {}} />, { session: admin });
    fireEvent.click(await screen.findByRole("button", { name: "Delete Office" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/tasks are kept/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.path.endsWith("/1"))).toBe(true));
  });

  it("shows why a name is refused", async () => {
    api({ "POST /api/tasks/categories": { ok: false, status: 409, json: async () => ({ error: "category_exists" }) } });
    renderWithProviders(<CategoryManager onClose={() => {}} />);
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "office" } });
    fireEvent.click(screen.getByRole("button", { name: "Add category" }));
    expect(await screen.findByText("A category with that name already exists.")).toBeInTheDocument();
  });
});
