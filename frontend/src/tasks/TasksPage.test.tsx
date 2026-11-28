import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COMPANY_TIME_ZONE, addDays, todayIn } from "../schedule/scheduleDates";
import { DEFAULT_PREFERENCES } from "../preferences";
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

/** The category and people switches live in the gear menu: opens it when it is closed. */
const menuToggle = (name: string) => {
  if (!screen.queryByRole("menu")) fireEvent.click(screen.getByRole("button", { name: "View and categories" }));
  return screen.getByRole("menuitemcheckbox", { name });
};

const page = (show = false) => renderWithProviders(<TasksPage />, { route: "/tasks", preferences: { ...DEFAULT_PREFERENCES, show_task_categories: show } });

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
    expect(document.querySelector("svg[data-art='tasks']")).toBeInTheDocument();
    expect(screen.getByText("Add one and give the team something to cross off!")).toBeInTheDocument();
  });

  it("has a picture and a friendly line when a tab of the list is empty", async () => {
    api([task({ title: "Open" })]);
    page();
    await screen.findByText("Open");
    fireEvent.click(screen.getByRole("radio", { name: "Done" }));
    expect(await screen.findByText("Nothing is done yet.")).toBeInTheDocument();
    expect(screen.getByText("The first check mark feels great, go get it!")).toBeInTheDocument();
    expect(document.querySelector("svg[data-art='tasks']")).toBeInTheDocument();
  });

  it("the clear dialog only counts the completed tasks the person may delete", async () => {
    api([
      done({ title: "Mine" }), done({ title: "Theirs", created_by: { id: 7, name: "Zoe" }, people: [7] }), task({ title: "Still open" }),
    ]);
    page();
    await screen.findByText("Still open");
    fireEvent.click(screen.getByRole("radio", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "View and categories" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Clear completed" }));
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
    page(true);
    await screen.findByText("In office");
    expect(screen.getByRole("button", { name: "🏢 Office 2" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "🏢 Office 2" }));
    expect(screen.queryByText("In shop")).not.toBeInTheDocument();
    expect(screen.getByText("In office 2")).toBeInTheDocument();
  });

  describe("the category chips button", () => {
    const withCategories = () => mockApi({
      "GET /api/schedule/people": { people: PEOPLE },
      "GET /api/tasks/categories": { categories: [{ id: 1, name: "Office", icon: "🏢" }, { id: 2, name: "Shop", icon: "🛒" }] },
      "GET /api/tasks": () => ({ tasks: [task({ title: "In office", category_id: 1 }), task({ title: "In shop", category_id: 2 })] }),
      "PATCH /api/me/preferences": { preferences: {} },
    });

    it("keeps the chips hidden until they are turned on", async () => {
      withCategories();
      page();
      await screen.findByText("In office");
      expect(screen.queryByRole("group", { name: "Category" })).not.toBeInTheDocument();
      expect(menuToggle("Show category chips")).toHaveAttribute("aria-checked", "false");
    });

    it("turns the chips on and off, and saves the choice to the account", async () => {
      const { calls } = withCategories();
      page();
      await screen.findByText("In office");
      fireEvent.click(menuToggle("Show category chips"));
      expect(await screen.findByRole("button", { name: "🏢 Office 1" })).toBeInTheDocument();
      expect(menuToggle("Show category chips")).toHaveAttribute("aria-checked", "true");
      await waitFor(() => expect(calls.some((c) => c.method === "PATCH" && JSON.stringify(c.body) === JSON.stringify({ show_task_categories: true }))).toBe(true));
      fireEvent.click(menuToggle("Show category chips"));
      expect(screen.queryByRole("button", { name: "🏢 Office 1" })).not.toBeInTheDocument();
    });

    it("shows every task again when the chips are turned off with a category picked", async () => {
      withCategories();
      page(true);
      await screen.findByText("In office");
      fireEvent.click(screen.getByRole("button", { name: "🏢 Office 1" }));
      expect(screen.queryByText("In shop")).not.toBeInTheDocument();
      fireEvent.click(menuToggle("Show category chips"));
      expect(screen.getByText("In shop")).toBeInTheDocument();
    });
  });

  it("Staff cannot manage categories; admins can", async () => {
    api([task({ title: "Open one" })]);
    const { unmount } = page();
    await screen.findByText("Open one");
    fireEvent.click(screen.getByRole("button", { name: "View and categories" }));
    expect(screen.getByRole("menuitemradio", { name: "List" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Manage categories" })).not.toBeInTheDocument();
    unmount();
    renderWithProviders(<TasksPage />, { route: "/tasks", session: { user: { id: 1, username: "a", name: "A", email: "a@x.ca", role: "admin", locale: "en" } } });
    await screen.findByText("Open one");
    fireEvent.click(screen.getByRole("button", { name: "View and categories" }));
    expect(screen.getByRole("menuitem", { name: "Manage categories" })).toBeInTheDocument();
  });

  describe("faces for Staff", () => {
    const FOUR = [...PEOPLE, { id: 3, name: "Carol Gagnon", color: "red", active: true }, { id: 4, name: "Dave Lavoie", color: "green", active: true }];
    const tasksOf = () => [task({ title: "Shared", people: [1, 2] }), task({ title: "Mine", people: [1] })];

    it("show only the people who share a task with the person, and themself", async () => {
      api(tasksOf(), { "GET /api/schedule/people": { people: FOUR } });
      page();
      await screen.findByText("Shared");
      const faces = screen.getByRole("group", { name: "Show" });
      expect(within(faces).getByRole("button", { name: "Alice Roy" })).toBeInTheDocument();
      expect(within(faces).getByRole("button", { name: "Bob Tremblay" })).toBeInTheDocument();
      expect(within(faces).queryByRole("button", { name: "Carol Gagnon" })).not.toBeInTheDocument();
      expect(within(faces).queryByRole("button", { name: "Dave Lavoie" })).not.toBeInTheDocument();
    });

    it("show everyone to an admin", async () => {
      api(tasksOf(), { "GET /api/schedule/people": { people: FOUR } });
      renderWithProviders(<TasksPage />, { route: "/tasks", session: { user: { id: 1, username: "a", name: "A", email: "a@x.ca", role: "admin", locale: "en" } } });
      await screen.findByText("Shared");
      const faces = screen.getByRole("group", { name: "Show" });
      expect(within(faces).getByRole("button", { name: "Dave Lavoie" })).toBeInTheDocument();
    });
  });

  describe("people filter switch", () => {
    const admin = { user: { id: 1, username: "a", name: "A", email: "a@x.ca", role: "admin" as const, locale: "en" as const } };
    it("is not offered to Staff, who always see their faces", async () => {
      api([task({ title: "Open one" })]);
      renderWithProviders(<TasksPage />, { route: "/tasks", preferences: { ...DEFAULT_PREFERENCES, show_task_people: false } });
      await screen.findByText("Open one");
      fireEvent.click(screen.getByRole("button", { name: "View and categories" }));
      expect(screen.queryByRole("menuitemcheckbox", { name: "Show people filter" })).not.toBeInTheDocument();
      expect(screen.getByRole("menuitemcheckbox", { name: "Show category chips" })).toBeInTheDocument();
      expect(screen.getByRole("group", { name: "Show" })).toBeInTheDocument();
    });

    it("shows the faces by default; the switch hides them and saves the choice to the account", async () => {
      const { calls } = api([task({ title: "Open one" })]);
      renderWithProviders(<TasksPage />, { route: "/tasks", session: admin });
      await screen.findByText("Open one");
      const button = menuToggle("Show people filter");
      expect(button).toHaveAttribute("aria-checked", "true");
      expect(screen.getByRole("group", { name: "Show" })).toBeInTheDocument();
      fireEvent.click(button);
      expect(screen.queryByRole("group", { name: "Show" })).not.toBeInTheDocument();
      expect(button).toHaveAttribute("aria-checked", "false");
      await waitFor(() => expect(calls.some((c) => c.method === "PATCH" && JSON.stringify(c.body) === JSON.stringify({ show_task_people: false }))).toBe(true));
    });

    it("stops filtering by people while the faces are hidden", async () => {
      api([task({ title: "For Bob", people: [2] }), task({ title: "For Alice", people: [1] })]);
      renderWithProviders(<TasksPage />, { route: "/tasks?people=2", session: admin, preferences: { ...DEFAULT_PREFERENCES, show_task_people: false } });
      expect(await screen.findByText("For Bob")).toBeInTheDocument();
      expect(screen.getByText("For Alice")).toBeInTheDocument();
    });
  });

  describe("on a phone", () => {
    beforeEach(() => {
      vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("max-width: 640px"), addEventListener: () => undefined, removeEventListener: () => undefined }));
    });
    const phone = () => renderWithProviders(<TasksPage />, { route: "/tasks", preferences: { ...DEFAULT_PREFERENCES, show_task_categories: true } });
    const withCats = () => api([task({ title: "In office", category_id: 1 }), task({ title: "In shop", category_id: 2 })], {
      "GET /api/tasks/categories": { categories: [{ id: 1, name: "Office", icon: "🏢" }, { id: 2, name: "Shop", icon: "🛒" }] },
    });

    it("puts the categories in a dropdown instead of chips", async () => {
      withCats();
      phone();
      await screen.findByText("In office");
      expect(screen.queryByRole("group", { name: "Filter by category" })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Filter by category: All" }));
      fireEvent.click(screen.getByRole("menuitemradio", { name: "🏢 Office" }));
      expect(screen.queryByText("In shop")).not.toBeInTheDocument();
      expect(screen.getByText("In office")).toBeInTheDocument();
    });

    it("puts the search box on its own line above the status switch", async () => {
      withCats();
      phone();
      await screen.findByText("In office");
      fireEvent.click(screen.getByRole("button", { name: "Search tasks" }));
      const search = screen.getByRole("searchbox");
      const status = screen.getByRole("radiogroup", { name: "Which tasks" });
      expect(search.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });

  it("on a wide screen the search box opens right beside the faces, search first", async () => {
    api([task({ title: "Open one" })]);
    page();
    await screen.findByText("Open one");
    fireEvent.click(screen.getByRole("button", { name: "Search tasks" }));
    const group = screen.getByRole("searchbox").closest(".tasks-toolbar__find");
    expect(group).not.toBeNull();
    const faces = screen.getByRole("group", { name: "Show" });
    expect(group!.contains(faces)).toBe(true);
    expect(screen.getByRole("searchbox").compareDocumentPosition(faces) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps the chips and the search box beside the status switch on a wide screen", async () => {
    api([task({ title: "Open one" })]);
    page(true);
    await screen.findByText("Open one");
    fireEvent.click(screen.getByRole("button", { name: "Search tasks" }));
    const search = screen.getByRole("searchbox");
    const status = screen.getByRole("radiogroup", { name: "Which tasks" });
    expect(status.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("falls back to All when the picked category is deleted", async () => {
    let cats = [{ id: 1, name: "Office", icon: "🏢" }];
    const { calls } = mockApi({
      "GET /api/schedule/people": { people: PEOPLE },
      "GET /api/tasks/categories": () => ({ categories: cats }),
      "GET /api/tasks": () => ({ tasks: [task({ title: "In office", category_id: 1 }), task({ title: "Elsewhere", category_id: null })] }),
      "DELETE /api/tasks/categories/1": () => { cats = []; return { ok: true, status: 204, json: async () => ({}) }; },
    });
    renderWithProviders(<TasksPage />, { route: "/tasks", preferences: { ...DEFAULT_PREFERENCES, show_task_categories: true }, session: { user: { id: 1, username: "a", name: "A", email: "a@x.ca", role: "admin", locale: "en" } } });
    await screen.findByText("In office");
    fireEvent.click(screen.getByRole("button", { name: "🏢 Office 1" }));
    expect(screen.queryByText("Elsewhere")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View and categories" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Manage categories" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete Office" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE")).toBe(true));
    fireEvent.click(await screen.findByRole("button", { name: "Back to tasks" }));
    expect(await screen.findByText("Elsewhere")).toBeInTheDocument();
    expect(screen.getByText("In office")).toBeInTheDocument();
  });

  it("has To do, In progress and Done tabs and no All", async () => {
    api([task({ title: "Open one" })]);
    page();
    await screen.findByText("Open one");
    expect(screen.getAllByRole("radio").map((r) => r.textContent)).toEqual(["To do", "In progress", "Done"]);
  });

  it("the view menu switches to the board and a card moves to in progress on the server", async () => {
    const { calls } = api([task({ title: "Mop the floor" })], { "POST /api/tasks/1/start": { task: {} }, "PATCH /api/me/preferences": { preferences: {} } });
    n = 0;
    page();
    await screen.findByText("Mop the floor");
    fireEvent.click(screen.getByRole("button", { name: "View and categories" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Board" }));
    expect(screen.queryAllByRole("radio", { name: "Done" })).toHaveLength(0); // tabs are gone
    fireEvent.change(await screen.findByRole("combobox", { name: "Move Mop the floor to" }), { target: { value: "in_progress" } });
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path.endsWith("/start"))).toBe(true));
  });
});
