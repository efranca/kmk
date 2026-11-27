import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COMPANY_TIME_ZONE, addDays, todayIn } from "../schedule/scheduleDates";
import { mockApi, renderWithProviders, resetLanguage, useEnglish } from "../testUtils";
import { TaskDialog } from "./TaskDialog";
import type { Task } from "./types";

const today = todayIn(COMPANY_TIME_ZONE);
const PEOPLE = [
  { id: 1, name: "Alice Roy", color: "teal", active: true },
  { id: 2, name: "Bob Tremblay", color: "blue", active: true },
];
const existing: Task = {
  id: 5, title: "Wash windows", description: "Front side", icon: "🪟", category_id: 3, people: [2], status: "pending", due_date: today,
  completed_at: null, show_on_dashboard: false, created_by: { id: 1, name: "Alice Roy" }, updated_by: { id: 2, name: "Bob Tremblay" },
  created_at: "2026-11-01T12:00:00Z", updated_at: "2026-11-02T12:00:00Z",
};

function api(extra: Record<string, unknown> = {}) {
  return mockApi({
    "GET /api/schedule/people": { people: PEOPLE },
    "GET /api/tasks/categories": { categories: [{ id: 3, name: "Office", icon: "🏢" }] },
    ...extra,
  });
}
const lastBody = (calls: { method: string; body: unknown }[], method: string) => calls.filter((c) => c.method === method).at(-1)?.body;

beforeEach(async () => { await useEnglish(); });
afterEach(async () => { vi.unstubAllGlobals(); await resetLanguage(); });

describe("TaskDialog", () => {
  it("creates a task with the fields that were filled in", async () => {
    const { calls } = api({ "POST /api/tasks": { task: existing } });
    const onClose = vi.fn();
    renderWithProviders(<TaskDialog task={null} defaultPeople={[]} onClose={onClose} />);
    fireEvent.change(await screen.findByLabelText("Title"), { target: { value: "Mop the floor" } });
    fireEvent.click(await screen.findByRole("button", { name: "Bob Tremblay" }));
    fireEvent.click(screen.getByRole("button", { name: "Tomorrow" }));
    fireEvent.change(screen.getByLabelText(/Description/), { target: { value: "Blue bucket" } });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(lastBody(calls, "POST")).toEqual({
      title: "Mop the floor", description: "Blue bucket", icon: "🧹", category_id: 3, client_id: null, people: [2], due_date: addDays(today, 1), show_on_dashboard: true,
    });
  });

  it("the icon follows the title until one is picked by hand", async () => {
    api();
    renderWithProviders(<TaskDialog task={null} defaultPeople={[]} onClose={() => {}} />);
    const title = await screen.findByLabelText("Title");
    fireEvent.change(title, { target: { value: "Mop" } });
    expect(screen.getByRole("button", { name: "Icon" })).toHaveTextContent("🧹");
    fireEvent.click(screen.getByRole("button", { name: "Icon" }));
    fireEvent.click(screen.getByRole("button", { name: "🛒" }));
    fireEvent.change(title, { target: { value: "Mop more" } });
    expect(screen.getByRole("button", { name: "Icon" })).toHaveTextContent("🛒");
  });

  it("Today and Tomorrow are chips that can be turned off again", async () => {
    api();
    renderWithProviders(<TaskDialog task={null} defaultPeople={[]} onClose={() => {}} />);
    const chip = await screen.findByRole("button", { name: "Today" });
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "false");
  });

  it("a new task starts with the people that were picked on the page", async () => {
    api();
    renderWithProviders(<TaskDialog task={null} defaultPeople={[2]} onClose={() => {}} />);
    expect(await screen.findByRole("button", { name: "Bob Tremblay" })).toHaveAttribute("aria-pressed", "true");
  });

  it("does not save a blank title and says why", async () => {
    const { calls } = api();
    renderWithProviders(<TaskDialog task={null} defaultPeople={[]} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    expect(await screen.findByText(/Give the task a title/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("an existing task shows who added and who changed it, and saves with PATCH", async () => {
    const { calls } = api({ "PATCH /api/tasks/5": { task: existing } });
    const onClose = vi.fn();
    renderWithProviders(<TaskDialog task={existing} defaultPeople={[]} onClose={onClose} />);
    expect(await screen.findByText(/Added by Alice Roy/)).toBeInTheDocument();
    expect(screen.getByText(/Changed by Bob Tremblay/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Wash all windows" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(lastBody(calls, "PATCH")).toMatchObject({ title: "Wash all windows", people: [2], category_id: 3, due_date: today, show_on_dashboard: false });
  });

  it("asks before deleting", async () => {
    const { calls } = api({ "DELETE /api/tasks/5": reply204() });
    const onClose = vi.fn();
    renderWithProviders(<TaskDialog task={existing} defaultPeople={[]} onClose={onClose} />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    const question = screen.getByText("Delete this task?");
    fireEvent.click(within(question.parentElement!).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls.some((c) => c.method === "DELETE" && c.path === "/api/tasks/5")).toBe(true);
  });

  it("is read only for someone who may not change the task", async () => {
    api();
    const others = { ...existing, created_by: { id: 7, name: "Zoe" }, people: [7] };
    renderWithProviders(<TaskDialog task={others} defaultPeople={[]} onClose={() => {}} />);
    expect(await screen.findByText(/only its creator/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toBeDisabled();
  });

  it("says a task made by the website was added by the Website", async () => {
    api();
    const fromWebsite: Task = { ...existing, created_by: null, updated_by: null, updated_at: existing.created_at };
    renderWithProviders(<TaskDialog task={fromWebsite} defaultPeople={[]} onClose={vi.fn()} />);
    expect(await screen.findByText(/Added by Website on/)).toBeInTheDocument();
  });
});

function reply204() {
  return { ok: true, status: 204, json: async () => ({}) };
}
