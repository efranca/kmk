// Server state of the tasks (TanStack Query). Every change invalidates the task lists.
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { useSession } from "../session";
import {
  clearCompleted, completeTask, createCategory, createTask, deleteCategory, deleteTask, listCategories, listTasks,
  reopenTask, startTask, updateCategory, updateTask,
} from "./api";
import type { CategoryInput, StatusFilter, Task, TaskInput, TaskStatus } from "./types";

export const taskKeys = {
  all: ["tasks"] as const,
  lists: ["tasks", "list"] as const,
  list: (status: StatusFilter, person: number | "none" | undefined) => ["tasks", "list", status, person ?? "any"] as const,
  categories: ["tasks", "categories"] as const,
};

export function useTasks(status: StatusFilter, person?: number | "none", enabled = true) {
  return useQuery({ queryKey: taskKeys.list(status, person), queryFn: () => listTasks(status, person), enabled });
}

export function useCategories() {
  return useQuery({ queryKey: taskKeys.categories, queryFn: listCategories, staleTime: 60_000 });
}

const refresh = (client: QueryClient) => client.invalidateQueries({ queryKey: taskKeys.all });

/** Creates (no `id`) or changes a task. */
export function useSaveTask() {
  const { csrfToken } = useSession();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: number; input: TaskInput }) => (id === undefined ? createTask(input, csrfToken) : updateTask(id, input, csrfToken)),
    onSuccess: () => refresh(client),
  });
}

export function useDeleteTask() {
  const { csrfToken } = useSession();
  const client = useQueryClient();
  return useMutation({ mutationFn: (id: number) => deleteTask(id, csrfToken), onSuccess: () => refresh(client) });
}

export function useClearCompleted() {
  const { csrfToken } = useSession();
  const client = useQueryClient();
  return useMutation({ mutationFn: () => clearCompleted(csrfToken), onSuccess: () => refresh(client) });
}

const SEND = { completed: completeTask, in_progress: startTask, pending: reopenTask } as const;

/** Moves a task to a status. It changes at once in every cached list and goes back if the server refuses. */
export function useSetTaskStatus() {
  const { csrfToken } = useSession();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ task, status }: { task: Task; status: TaskStatus }) => SEND[status](task.id, csrfToken),
    onMutate: async ({ task, status }) => {
      await client.cancelQueries({ queryKey: taskKeys.lists });
      const before = client.getQueriesData<Task[]>({ queryKey: taskKeys.lists });
      client.setQueriesData<Task[]>({ queryKey: taskKeys.lists }, (list) =>
        list?.map((x) => (x.id === task.id ? { ...x, status, completed_at: status === "completed" ? new Date().toISOString() : null } : x)),
      );
      return { before };
    },
    onError: (_error, _vars, context) => {
      for (const [key, data] of context?.before ?? []) client.setQueryData(key, data);
    },
    onSettled: () => refresh(client),
  });
}

/** Ticks or unticks a task (done, or back to to do). */
export function useToggleTask() {
  const { mutate, ...rest } = useSetTaskStatus();
  return { ...rest, mutate: (task: Task) => mutate({ task, status: task.status === "completed" ? "pending" : "completed" }) };
}

export function useSaveCategory() {
  const { csrfToken } = useSession();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: number; input: CategoryInput }) =>
      id === undefined ? createCategory(input, csrfToken) : updateCategory(id, input, csrfToken),
    onSuccess: () => refresh(client),
  });
}

export function useDeleteCategory() {
  const { csrfToken } = useSession();
  const client = useQueryClient();
  return useMutation({ mutationFn: (id: number) => deleteCategory(id, csrfToken), onSuccess: () => refresh(client) });
}
