import type { User } from "../api";
import type { Task } from "./types";

type Who = Pick<User, "id" | "role">;
const isAdmin = (user: Who) => user.role !== "user";

/** Whether the signed-in user may edit or delete a task. Mirrors the server (app/auth/policy.py), which stays the
 * authority: admins, the creator, or a person the task is for. A task for the whole team: its creator or an admin. */
export function canChangeTask(user: Who, task: Pick<Task, "created_by" | "people">): boolean {
  return isAdmin(user) || user.id === task.created_by?.id || task.people.includes(user.id);
}

/** Whether the user may complete or reopen: whoever may edit it, and anyone for a task for the whole team. */
export function canSetTaskStatus(user: Who, task: Pick<Task, "created_by" | "people">): boolean {
  return canChangeTask(user, task) || task.people.length === 0;
}

/** Anyone adds a category; only admins rename, re-icon or delete one. */
export function canManageCategories(user: Who): boolean {
  return isAdmin(user);
}
