import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Segmented } from "../ui/Segmented";
import { AvatarGroup } from "../ui/AvatarGroup";
import type { Person } from "../ui/Avatar";
import { DEFAULT_CATEGORY_ICON } from "./CategoryChips";
import type { Category, Task, TaskStatus } from "./types";

const COLUMNS: { status: TaskStatus; label: "taskStatusPending" | "taskStatusInProgress" | "taskStatusCompleted" }[] = [
  { status: "pending", label: "taskStatusPending" },
  { status: "in_progress", label: "taskStatusInProgress" },
  { status: "completed", label: "taskStatusCompleted" },
];

const byDueThenNewest = (a: Task, b: Task) =>
  (a.due_date ?? "9999-12-31").localeCompare(b.due_date ?? "9999-12-31") || b.created_at.localeCompare(a.created_at) || b.id - a.id;

/**
 * Three columns, one per status. A card moves by dragging it onto another column, or with its "Move to" control (which
 * also works on a phone and from the keyboard). Only cards the person may change are draggable.
 */
export function TaskBoard({
  tasks,
  people,
  categoryById,
  today,
  canMove,
  onMove,
  onOpen,
  narrow = false,
}: {
  tasks: Task[];
  people: ReadonlyMap<number, Person>;
  categoryById: ReadonlyMap<number, Category>;
  today: string;
  canMove: (task: Task) => boolean;
  onMove: (task: Task, status: TaskStatus) => void;
  onOpen: (task: Task) => void;
  /** On a phone: one column at a time behind tabs (nobody drags a card there, and three columns do not fit). */
  narrow?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [over, setOver] = useState<TaskStatus | null>(null);
  const [dragging, setDragging] = useState<Task | null>(null);
  const [tab, setTab] = useState<TaskStatus>("pending");
  const dateFormat = new Intl.DateTimeFormat(i18n.language, { weekday: "short", day: "numeric", month: "short" });

  const drop = (status: TaskStatus) => {
    setOver(null);
    const task = dragging;
    setDragging(null);
    if (task && task.status !== status && canMove(task)) onMove(task, status);
  };

  return (
    <>
    {narrow && (
      <div className="board-tabs">
        <Segmented label={t("taskStatusLabel")} value={tab} onChange={setTab}
          options={COLUMNS.map(({ status, label }) => ({ value: status, label: t(label) }))} />
      </div>
    )}
    <div className={narrow ? "board board--tabs" : "board"}>
      {COLUMNS.filter(({ status }) => !narrow || status === tab).map(({ status, label }) => {
        const cards = tasks.filter((x) => x.status === status).sort(byDueThenNewest);
        return (
          <section
            key={status}
            role="group"
            aria-label={`${t(label)} ${cards.length}`}
            className={`board__column ${over === status ? "board__column--over" : ""}`}
            onDragOver={(e) => {
              if (!dragging) return;
              e.preventDefault();
              setOver(status);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o === status ? null : o));
            }}
            onDrop={(e) => {
              e.preventDefault();
              drop(status);
            }}
          >
            <h2 className="board__title">{t(label)} <span className="board__count">{cards.length}</span></h2>
            <ul className="board__cards">
              {cards.length === 0 && <li className="board__empty">{t("taskBoardEmpty")}</li>}
              {cards.map((task) => {
                const movable = canMove(task);
                const faces = task.people.map((id) => people.get(id)).filter((p): p is Person => p !== undefined);
                const overdue = status !== "completed" && task.due_date !== null && task.due_date < today;
                const category = task.category_id ? categoryById.get(task.category_id) : undefined;
                return (
                  <li
                    key={task.id}
                    className={`card-task ${status === "completed" ? "card-task--done" : ""}`}
                    draggable={movable || undefined}
                    onDragStart={(e) => {
                      if (!movable) return;
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", String(task.id));
                      setDragging(task);
                    }}
                    onDragEnd={() => {
                      setDragging(null);
                      setOver(null);
                    }}
                  >
                    <button type="button" className="card-task__open" onClick={() => onOpen(task)}>
                      <span className="card-task__title">{task.icon && <span aria-hidden="true">{task.icon} </span>}{task.title}</span>
                      {task.due_date && (
                        <span className={`task__due ${overdue ? "task__due--overdue" : ""}`}>{dateFormat.format(new Date(`${task.due_date}T12:00:00`))}</span>
                      )}
                    </button>
                    <div className="card-task__foot">
                      {category && <span className="task__category" title={category.name} aria-hidden="true">{category.icon ?? DEFAULT_CATEGORY_ICON}</span>}
                      {movable && (
                        <select
                          className="card-task__move"
                          aria-label={t("taskMoveTo", { title: task.title })}
                          value={task.status}
                          onChange={(e) => onMove(task, e.target.value as TaskStatus)}
                        >
                          {COLUMNS.map((c) => <option key={c.status} value={c.status}>{t(c.label)}</option>)}
                        </select>
                      )}
                      <span className="card-task__people">
                        <AvatarGroup people={faces} everyone={task.people.length === 0} mutedIds={new Set(faces.filter((p) => p.active === false).map((p) => p.id))} />
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
    </>
  );
}
