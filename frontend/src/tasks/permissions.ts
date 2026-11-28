import type { User } from "../api";
import type { Task } from "./types";

type Who = Pick<User, "id" | "role">;
const isAdmin = (user: Who) => user.role !== "user";

/** Whether the signed-in user may edit or delete a task. The server decides (`editable`, app/auth/policy.py): admins; for
 * Staff, the tasks they made or are on, except the ones an administrator made. */
export function canChangeTask(user: Who, task: Pick<Task, "created_by" | "people"> & { editable?: boolean }): boolean {
  return task.editable ?? (isAdmin(user) || user.id === task.created_by?.id || task.people.includes(user.id));
}

/** Whether the user may move, complete or reopen: admins, its creator, or a person it is for (whoever made it). */
export function canSetTaskStatus(user: Who, task: Pick<Task, "created_by" | "people">): boolean {
  return isAdmin(user) || user.id === task.created_by?.id || task.people.includes(user.id);
}

/** Anyone adds a category; only admins rename, re-icon or delete one. */
export function canManageCategories(user: Who): boolean {
  return isAdmin(user);
}
