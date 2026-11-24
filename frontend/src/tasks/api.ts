import { request } from "../schedule/api";
import type { Category, CategoryInput, StatusFilter, Task, TaskInput } from "./types";

const BASE = "/api/tasks";

export async function listTasks(status: StatusFilter, person?: number | "none"): Promise<Task[]> {
  const params = new URLSearchParams({ status });
  if (person !== undefined) params.set("person", String(person));
  return (await request<{ tasks: Task[] }>("GET", `${BASE}?${params}`)).tasks;
}

export async function createTask(input: TaskInput, csrf: string): Promise<Task> {
  return (await request<{ task: Task }>("POST", BASE, csrf, input)).task;
}

export async function updateTask(id: number, input: TaskInput, csrf: string): Promise<Task> {
  return (await request<{ task: Task }>("PATCH", `${BASE}/${id}`, csrf, input)).task;
}

export async function completeTask(id: number, csrf: string): Promise<Task> {
  return (await request<{ task: Task }>("POST", `${BASE}/${id}/complete`, csrf)).task;
}

export async function reopenTask(id: number, csrf: string): Promise<Task> {
  return (await request<{ task: Task }>("POST", `${BASE}/${id}/reopen`, csrf)).task;
}

export async function deleteTask(id: number, csrf: string): Promise<void> {
  await request("DELETE", `${BASE}/${id}`, csrf);
}

/** Deletes the completed tasks the signed-in person may delete; resolves with how many went. */
export async function clearCompleted(csrf: string): Promise<number> {
  return (await request<{ deleted: number }>("DELETE", `${BASE}/completed`, csrf)).deleted;
}

export async function listCategories(): Promise<Category[]> {
  return (await request<{ categories: Category[] }>("GET", `${BASE}/categories`)).categories;
}

export async function createCategory(input: CategoryInput, csrf: string): Promise<Category> {
  return (await request<{ category: Category }>("POST", `${BASE}/categories`, csrf, input)).category;
}

export async function updateCategory(id: number, input: CategoryInput, csrf: string): Promise<Category> {
  return (await request<{ category: Category }>("PATCH", `${BASE}/categories/${id}`, csrf, input)).category;
}

export async function deleteCategory(id: number, csrf: string): Promise<void> {
  await request("DELETE", `${BASE}/categories/${id}`, csrf);
}
