import { useTranslation } from "react-i18next";

import { AvatarGroup } from "../ui/AvatarGroup";
import type { Person } from "../ui/Avatar";
import type { Category, Task } from "./types";

const FALLBACK_CATEGORY_ICON = "🏷️";

interface TaskRowProps {
  task: Task;
  people: ReadonlyMap<number, Person>;
  category?: Category;
  canToggle: boolean;
  onToggle: () => void;
  onOpen: () => void;
  /** The date that counts as today, to mark overdue tasks. */
  today?: string;
}

/** One task: a checkbox, its icon and title, the due date, its category as a small round icon, and its people's faces. */
export function TaskRow({ task, people, category, canToggle, onToggle, onOpen, today }: TaskRowProps) {
  const { i18n } = useTranslation();
  const done = task.status === "completed";
  const faces = task.people.map((id) => people.get(id)).filter((p): p is Person => p !== undefined);
  const muted = new Set(faces.filter((p) => p.active === false).map((p) => p.id));
  const overdue = !done && task.due_date !== null && today !== undefined && task.due_date < today;
  const due = task.due_date ? new Intl.DateTimeFormat(i18n.language, { weekday: "short", day: "numeric", month: "short" }).format(new Date(`${task.due_date}T12:00:00`)) : null;
  return (
    <li className={`task ${done ? "task--done" : ""}`}>
      <input type="checkbox" className="task__check" checked={done} disabled={!canToggle} aria-label={task.title} onChange={onToggle} />
      <button type="button" className="task__open" onClick={onOpen}>
        {task.icon && <span className="task__icon" aria-hidden="true">{task.icon}</span>}
        <span className="task__text">
          <span className="task__title">{task.title}</span>
          {due && <span className={`task__due ${overdue ? "task__due--overdue" : ""}`}>{due}</span>}
        </span>
        {category && <span className="task__category" title={category.name} aria-hidden="true">{category.icon ?? FALLBACK_CATEGORY_ICON}</span>}
      </button>
      <AvatarGroup people={faces} everyone={task.people.length === 0} mutedIds={muted} />
    </li>
  );
}
