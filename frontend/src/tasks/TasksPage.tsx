import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useSession } from "../session";
import { COMPANY_TIME_ZONE, todayIn } from "../schedule/scheduleDates";
import { useNarrow } from "../schedule/useNarrow";
import { usePeople } from "../schedule/hooks";
import { Avatar } from "../ui/Avatar";
import { AvatarFilter } from "../ui/AvatarFilter";
import { Button, IconButton } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { EmptyState, ErrorNotice, Loading } from "../ui/Feedback";
import { PageHeader } from "../ui/PageHeader";
import { Segmented } from "../ui/Segmented";
import { useToast } from "../ui/toastContext";
import type { Person } from "../ui/Avatar";
import { dueGroup, type DueGroup } from "./dueGroup";
import { useCategories, useClearCompleted, useTasks, useToggleTask } from "./hooks";
import { canChangeTask, canSetTaskStatus } from "./permissions";
import { matchesSearch } from "./search";
import { TaskDialog } from "./TaskDialog";
import { TaskRow } from "./TaskRow";
import type { StatusFilter, Task } from "./types";
import { useTaskPeople } from "./useTaskPeople";

const STATUSES: StatusFilter[] = ["pending", "completed", "all"];
const STATUS_KEYS = { pending: "taskStatusPending", completed: "taskStatusCompleted", all: "taskStatusAll" } as const;
const GROUP_KEYS = { overdue: "taskGroupOverdue", today: "taskGroupToday", week: "taskGroupWeek", later: "taskGroupLater", none: "taskGroupNone" } as const;

/** The team's to-do list: whose tasks, the status, then the tasks grouped by when they are due. */
export function TasksPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const { user } = useSession();
  const narrow = useNarrow();
  const today = todayIn(COMPANY_TIME_ZONE);
  const everyone = usePeople();
  const categories = useCategories();
  const [picked, setPicked] = useTaskPeople();
  const [status, setStatus] = useState<StatusFilter>("pending");
  const [searchOpen, setSearchOpen] = useState(false);
  const [text, setText] = useState("");
  const [clearing, setClearing] = useState(false);
  const [editing, setEditing] = useState<Task | "new" | null>(null);
  const toggle = useToggleTask();
  const clear = useClearCompleted();

  const searching = text.trim().length > 0;
  const all = useTasks("all");
  const list = useTasks(status);
  const shown = searching ? all : list;

  const members: Person[] = everyone.data ?? [];
  const byId = new Map(members.map((p) => [p.id, p]));
  const selectable = members.filter((p) => p.active !== false);
  const categoryById = new Map((categories.data ?? []).map((c) => [c.id, c]));
  const ofPicked = (tasks: Task[]) => (picked.length > 0 ? tasks.filter((x) => x.people.some((id) => picked.includes(id))) : tasks);

  const noTasksAtAll = all.data?.length === 0;
  const summary = ofPicked(all.data ?? []);
  const doneCount = summary.filter((x) => x.status === "completed").length;
  const total = summary.length;
  const pickedPeople = picked.map((id) => byId.get(id)).filter((p): p is Person => p !== undefined);
  const summaryTitle = t("taskSummaryOf", { names: pickedPeople.map((p) => p.name).join(", ") });

  const matching = (tasks: Task[]) =>
    searching
      ? tasks.filter((x) => matchesSearch(text, x.title, x.description, x.category_id ? categoryById.get(x.category_id)?.name : "", ...x.people.map((id) => byId.get(id)?.name)))
      : tasks;
  const visible = matching(ofPicked(shown.data ?? []));

  // What "Clear completed" removes is what the server will let this person remove, so the count says the same.
  const clearable = (all.data ?? []).filter((x) => x.status === "completed" && canChangeTask(user, x)).length;

  const groups: { key: DueGroup | "none"; tasks: Task[] }[] =
    status === "pending" && !searching
      ? (["overdue", "today", "week", "later", "none"] as const)
          .map((key) => ({ key, tasks: visible.filter((x) => (x.due_date ? dueGroup(x.due_date, today) : "none") === key) }))
          .filter((g) => g.tasks.length > 0)
      : [{ key: "none", tasks: visible }];

  const row = (task: Task) => (
    <TaskRow key={task.id} task={task} people={byId} category={task.category_id ? categoryById.get(task.category_id) : undefined} today={today}
      canToggle={canSetTaskStatus(user, task)} onToggle={() => toggle.mutate(task)} onOpen={() => setEditing(task)} />
  );

  return (
    <div className="page page--tasks">
      <PageHeader
        title={t("taskTitle")}
        actions={
          <>
            <IconButton icon="search" label={t("taskSearchLabel")} aria-pressed={searchOpen} onClick={() => { if (searchOpen) setText(""); setSearchOpen(!searchOpen); }} />
            <IconButton icon="plus" variant="primary" label={t("taskNew")} onClick={() => setEditing("new")} />
          </>
        }
      />
      {noTasksAtAll ? (
        <div className="tasks-empty">
          <EmptyState>{t("taskEmpty")}</EmptyState>
          <Button variant="primary" icon="plus" onClick={() => setEditing("new")}>{t("taskAddFirst")}</Button>
        </div>
      ) : (
        <>
          <div className="tasks-toolbar">
            {!searching && <Segmented label={t("taskStatusLabel")} value={status} onChange={setStatus} options={STATUSES.map((s) => ({ value: s, label: t(STATUS_KEYS[s]) }))} />}
            {searchOpen && (
              <label className="tasks-toolbar__search">
                <span className="visually-hidden">{t("taskSearchLabel")}</span>
                <input type="search" value={text} autoFocus placeholder={t("taskSearchPlaceholder")} onChange={(e) => setText(e.target.value)} />
              </label>
            )}
            <AvatarFilter people={selectable} selected={picked} onChange={setPicked} label={t("schWho")} everyoneLabel={t("everyone")}
              moreLabel={(count) => t("schWhoMore", { count })} max={narrow ? 2 : 6} size={narrow ? "sm" : "md"} />
          </div>
          {pickedPeople.length > 0 && all.data && (
            <section className="tasks-summary" aria-label={summaryTitle}>
              <span className="tasks-summary__faces">{pickedPeople.slice(0, 3).map((p) => <Avatar key={p.id} person={p} />)}</span>
              <div className="tasks-summary__text">
                <strong>{summaryTitle}</strong>
                <span>{t("taskCounts", { todo: total - doneCount, done: doneCount })}</span>
              </div>
              <span className="tasks-summary__meter" aria-hidden="true"><i style={{ width: `${total ? (doneCount / total) * 100 : 0}%` }} /></span>
            </section>
          )}
          {shown.isPending ? <Loading />
            : shown.isError ? <ErrorNotice error={shown.error} onRetry={() => void shown.refetch()} />
            : visible.length === 0 && searching ? <EmptyState>{t("taskSearchNoResults", { q: text.trim() })}</EmptyState>
            : visible.length === 0 ? <EmptyState>{t(status === "completed" ? "taskEmptyCompleted" : "taskEmptyPending")}</EmptyState>
            : (
              <div className="taskgroups">
                {groups.map((g) => (
                  <section key={g.key} className="taskgroup">
                    {status === "pending" && !searching && <h2 className="taskgroup__label">{t(GROUP_KEYS[g.key])}</h2>}
                    <ul className="tasks">{g.tasks.map(row)}</ul>
                  </section>
                ))}
              </div>
            )}
          {clearable > 0 && status !== "pending" && !searching && (
            <Button variant="ghost" icon="trash" className="tasks-clear" onClick={() => setClearing(true)}>{t("taskClearCompleted")}</Button>
          )}
        </>
      )}
      {clearing && (
        <Dialog open title={t("taskClearTitle")} onClose={() => setClearing(false)}
          footer={<>
            <Button variant="ghost" onClick={() => setClearing(false)}>{t("cancel")}</Button>
            <Button variant="danger" icon="trash" busy={clear.isPending}
              onClick={() => clear.mutate(undefined, { onSuccess: (deleted) => { setClearing(false); toast(t("taskCleared", { count: deleted })); } })}>
              {t("taskClearCompleted")}
            </Button>
          </>}>
          <p>{t("taskClearBody", { count: clearable })}</p>
          {clear.error && <ErrorNotice error={clear.error} />}
        </Dialog>
      )}
      {editing && <TaskDialog key={editing === "new" ? "new" : editing.id} task={editing === "new" ? null : editing} defaultPeople={picked} onClose={() => setEditing(null)} />}
    </div>
  );
}
