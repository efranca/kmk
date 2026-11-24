import type { Task } from "../tasks/types";

/** What the calendar views need to show tasks: the tasks of a day, and what ticking or opening one does. */
export interface TaskLayer {
  on: (date: string) => Task[];
  canToggle: (task: Task) => boolean;
  onToggle: (task: Task) => void;
  onOpen: (task: Task) => void;
}

/** A task on its due day: a checkbox and a one-line title. Never dragged: a task has a day, not an hour. */
export function TaskChip({ task, layer }: { task: Task; layer: TaskLayer }) {
  const done = task.status === "completed";
  return (
    <span className={`grid__chip grid__chip--task ${done ? "grid__chip--done" : ""}`}>
      <input type="checkbox" checked={done} disabled={!layer.canToggle(task)} aria-label={task.title} onChange={() => layer.onToggle(task)} />
      <button type="button" className="grid__chip__open" title={task.title} onClick={() => layer.onOpen(task)}>
        {task.icon && <span aria-hidden="true">{task.icon}</span>}
        <span>{task.title}</span>
      </button>
    </span>
  );
}
