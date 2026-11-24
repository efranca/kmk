import { useState } from "react";

export type TasksView = "list" | "board";
const KEY = "kmk.tasks.view";

function read(): TasksView {
  try {
    return localStorage.getItem(KEY) === "board" ? "board" : "list";
  } catch {
    return "list";
  }
}

/** List or board, remembered on this device (storage may be unavailable: the choice then lasts for the visit). */
export function useTasksView(): [TasksView, (view: TasksView) => void] {
  const [view, setView] = useState<TasksView>(read);
  const choose = (next: TasksView) => {
    setView(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* keep it for this visit */
    }
  };
  return [view, choose];
}
