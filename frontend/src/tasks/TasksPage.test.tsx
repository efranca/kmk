import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COMPANY_TIME_ZONE, addDays, todayIn } from "../schedule/scheduleDates";
import { mockApi, renderWithProviders, resetLanguage, useEnglish } from "../testUtils";
import { TasksPage } from "./TasksPage";
import type { Task } from "./types";

const today = todayIn(COMPANY_TIME_ZONE);
let n = 0;
function task(over: Partial<Task> = {}): Task {
  n += 1;
  return {
    id: n, title: `Task ${n}`, description: null, icon: null, category_id: null, people: [], status: "pending", due_date: null,
    completed_at: null, show_on_dashboard: true, created_by: { id: 1, name: "Alice Roy" }, updated_by: { id: 1, name: "Alice Roy" },
    created_at: "2026-11-01T12:00:00Z", updated_at: "2026-11-01T12:00:00Z", ...over,
  };
}
const done = (over: Partial<Task> = {}) => task({ status: "completed", completed_at: "2026-11-20T15:00:00Z", ...over });

const PEOPLE = [
  { id: 1, name: "Alice Roy", color: "teal", active: true },
  { id: 2, name: "Bob Tremblay", color: "blue", active: true },
];

function api(tasks: Task[], extra: Record<string, unknown> = {}) {
  return mockApi({
    "GET /api/schedule/people": { people: PEOPLE },
    "GET /api/tasks/categories": { categories: [] },
    "GET /api/tasks": ({ url }: { url: URL }) => {
      const status = url.searchParams.get("status") ?? "all";
      return { tasks: tasks.filter((x) => status === "all" || x.status === status) };
    },
    ...extra,
  });
}

beforeEach(async () => { await useEnglish(); });
afterEach(async () => { vi.unstubAllGlobals(); await resetLanguage(); });

const page = () => renderWithProviders(<TasksPage />, { route: "/tasks" });

describe("TasksPage", () => {
  it("lists the tasks to do grouped by when they are due", async () => {
    api([
      task({ title: "Overdue one", due_date: addDays(today, -2) }), task({ title: "Today one", due_date: today }),
      task({ title: "Soon one", due_date: addDays(today, 3) }), task({ title: "Far one", due_date: addDays(today, 30) }), task({ title: "Undated one" }),
      done({ title: "Finished one" }),
    ]);
    page();
    expect(await screen.findByText("Overdue one")).toBeInTheDocument();
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Overdue", "Today", "This week", "Later", "No date"]);
    expect(screen.queryByText("Finished one")).not.toBeInTheDocument();
  });

  it("the status switch shows the done tasks", async () => {
    const { calls } = api([task({ title: "Open one" }), done({ title: "Finished one" })]);
    page();
    await screen.findByText("Open one");
    fireEvent.click(screen.getByRole("radio", { name: "Done" }));
    expect(await screen.findByText("Finished one")).toBeInTheDocument();
    expect(screen.queryByText("Open one")).not.toBeInTheDocument();
    expect(calls.some((c) => c.query.includes("status=completed"))).toBe(true);
  });

  it("keeps the people filter in the address and shows only their tasks", async () => {
    api([task({ title: "For Bob", people: [2] }), task({ title: "For Alice", people: [1] }), task({ title: "For all" })]);
    renderWithProviders(<TasksPage />, { route: "/tasks?people=2" });
    expect(await screen.findByText("For Bob")).toBeInTheDocument();
    expect(screen.queryByText("For Alice")).not.toBeInTheDocument();
    expect(screen.queryByText("For all")).not.toBeInTheDocument();
  });

  it("shows how a picked person is doing", async () => {
    api([task({ people: [2] }), task({ people: [2] }), done({ people: [2] }), task({ people: [1] })]);
    renderWithProviders(<TasksPage />, { route: "/tasks?people=2" });
    const card = await screen.findByRole("region", { name: /Bob Tremblay/ });
    expect(within(card).getByText("2 to do, 1 done")).toBeInTheDocument();
  });

  it("searches every task, done or not, ignoring accents and case", async () => {
    api([task({ title: "Open mop" }), done({ title: "Café du matin" })]);
    page();
    await screen.findByText("Open mop");
    fireEvent.click(screen.getByRole("button", { name: "Search tasks" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "CAFE" } });
    expect(await screen.findByText("Café du matin")).toBeInTheDocument();
    expect(screen.queryByText("Open mop")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzzz" } });
    expect(await screen.findByText(/No task matches/)).toBeInTheDocument();
  });

  it("offers to add the first task when there is none", async () => {
    api([]);
    page();
    expect(await screen.findByRole("button", { name: "Add the first task" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Done" })).not.toBeInTheDocument();
  });

  it("the clear dialog only counts the completed tasks the person may delete", async () => {
    api([
      done({ title: "Mine" }), done({ title: "Theirs", created_by: { id: 7, name: "Zoe" }, people: [7] }), task({ title: "Still open" }),
    ]);
    page();
    await screen.findByText("Still open");
    fireEvent.click(screen.getByRole("radio", { name: "All" }));
    fireEvent.click(await screen.findByRole("button", { name: "Clear completed" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("1 completed task will be deleted.")).toBeInTheDocument();
  });

  it("ticking a task completes it on the server", async () => {
    const { calls } = api([task({ title: "Mop the floor" })], { "POST /api/tasks/1/complete": { task: {} } });
    n = 0;
    page();
    fireEvent.click(await screen.findByRole("checkbox", { name: /Mop the floor/ }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path.endsWith("/complete"))).toBe(true));
  });

  it("a task for the whole team shows the Everyone face, a listed task the person's face", async () => {
    api([task({ title: "For all" }), task({ title: "For Bob", people: [2] })]);
    page();
    const all = (await screen.findByText("For all")).closest("li")!;
    expect(within(all).getByRole("img", { name: "Everyone" })).toBeInTheDocument();
    const bob = screen.getByText("For Bob").closest("li")!;
    expect(within(bob).getByRole("img", { name: "Bob Tremblay" })).toBeInTheDocument();
  });

  it("the plus button opens an empty task form, and a row opens that task", async () => {
    api([task({ title: "Mop the floor", description: "Blue bucket" })]);
    page();
    await screen.findByText("Mop the floor");
    fireEvent.click(screen.getByRole("button", { name: "New task" }));
    expect(await screen.findByRole("dialog", { name: "New task" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Mop the floor/ }));
    expect(await screen.findByDisplayValue("Blue bucket")).toBeInTheDocument();
  });

  it("category chips filter the list and count the tasks of each category", async () => {
    mockApi({
      "GET /api/schedule/people": { people: PEOPLE },
      "GET /api/tasks/categories": { categories: [{ id: 1, name: "Office", icon: "🏢" }, { id: 2, name: "Shop", icon: "🛒" }] },
      "GET /api/tasks": () => ({ tasks: [task({ title: "In office", category_id: 1 }), task({ title: "In shop", category_id: 2 }), task({ title: "In office 2", category_id: 1 })] }),
    });
    page();
    await screen.findByText("In office");
    expect(screen.getByRole("button", { name: "🏢 Office 2" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "🏢 Office 2" }));
    expect(screen.queryByText("In shop")).not.toBeInTheDocument();
    expect(screen.getByText("In office 2")).toBeInTheDocument();
  });

  it("falls back to All when the picked category is deleted", async () => {
    let cats = [{ id: 1, name: "Office", icon: "🏢" }];
    const { calls } = mockApi({
      "GET /api/schedule/people": { people: PEOPLE },
      "GET /api/tasks/categories": () => ({ categories: cats }),
      "GET /api/tasks": () => ({ tasks: [task({ title: "In office", category_id: 1 }), task({ title: "Elsewhere", category_id: null })] }),
      "DELETE /api/tasks/categories/1": () => { cats = []; return { ok: true, status: 204, json: async () => ({}) }; },
    });
    renderWithProviders(<TasksPage />, { route: "/tasks", session: { user: { id: 1, username: "a", name: "A", email: "a@x.ca", role: "admin", locale: "en" } } });
    await screen.findByText("In office");
    fireEvent.click(screen.getByRole("button", { name: "🏢 Office 1" }));
    expect(screen.queryByText("Elsewhere")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Manage categories" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete Office" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE")).toBe(true));
    fireEvent.click(await screen.findByRole("button", { name: "Back to tasks" }));
    expect(await screen.findByText("Elsewhere")).toBeInTheDocument();
    expect(screen.getByText("In office")).toBeInTheDocument();
  });
});
