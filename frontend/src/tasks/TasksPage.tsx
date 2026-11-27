import { useState } from "react";
import { useTranslation } from "react-i18next";

import { usePreferences } from "../preferences";
import { useSession } from "../session";
import { COMPANY_TIME_ZONE, todayIn } from "../schedule/scheduleDates";
import { useNarrow } from "../schedule/useNarrow";
import { usePeople } from "../schedule/hooks";
import { Avatar } from "../ui/Avatar";
import { AvatarFilter } from "../ui/AvatarFilter";
import { Button, IconButton } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { EmptyArt } from "../ui/EmptyArt";
import { EmptyState, ErrorNotice, Loading } from "../ui/Feedback";
import { PageHeader } from "../ui/PageHeader";
import { Segmented } from "../ui/Segmented";
import { useToast } from "../ui/toastContext";
import type { Person } from "../ui/Avatar";
import { dueGroup, type DueGroup } from "./dueGroup";
import { useCategories, useClearCompleted, useSetTaskStatus, useTasks, useToggleTask } from "./hooks";
import { canChangeTask, canManageCategories, canSetTaskStatus } from "./permissions";
import { matchesSearch } from "./search";
import { CategoryChips, FALLBACK_CATEGORY_ICON } from "./CategoryChips";
import { CategoryManager } from "./CategoryManager";
import { TaskBoard } from "./TaskBoard";
import { TaskDialog } from "./TaskDialog";
import { TaskRow } from "./TaskRow";
import { useTasksView } from "./useTasksView";
import { ViewMenuButton } from "./ViewMenuButton";
import type { Task, TaskStatus } from "./types";
import { useTaskPeople } from "./useTaskPeople";

const STATUSES: TaskStatus[] = ["pending", "in_progress", "completed"];
const STATUS_KEYS = { pending: "taskStatusPending", in_progress: "taskStatusInProgress", completed: "taskStatusCompleted" } as const;
const EMPTY_KEYS = { pending: "taskEmptyPending", in_progress: "taskEmptyInProgress", completed: "taskEmptyCompleted" } as const;
const EMPTY_FUN_KEYS = { pending: "taskEmptyPendingFun", in_progress: "taskEmptyInProgressFun", completed: "taskEmptyCompletedFun" } as const;
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
  const [pickedInUrl, setPicked] = useTaskPeople();
  const [status, setStatus] = useState<TaskStatus>("pending");
  const [searchOpen, setSearchOpen] = useState(false);
  const [text, setText] = useState("");
  const [clearing, setClearing] = useState(false);
  const [managing, setManaging] = useState(false);
  const [pick, setPick] = useState<number | null>(null);
  const [editing, setEditing] = useState<Task | "new" | null>(null);
  const [view, setView] = useTasksView();
  const { prefs, update } = usePreferences();
  const showChips = prefs.show_task_categories; // off until the person turns them on; it follows their account
  const showPeople = prefs.show_task_people; // on until they hide the faces; hidden faces cannot filter, so every task shows
  const picked = showPeople ? pickedInUrl : [];
  const toggle = useToggleTask();
  const move = useSetTaskStatus();
  const clear = useClearCompleted();

  const searching = text.trim().length > 0;
  const all = useTasks("all");
  const list = useTasks(status, undefined, view === "list");
  const shown = searching || view === "board" ? all : list;

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
  const loaded = matching(ofPicked(shown.data ?? []));
  // A picked category that was deleted falls back to All.
  // Hidden chips cannot filter: with them off, every task shows.
  const selected = showChips && pick !== null && categoryById.has(pick) ? pick : null;
  const countOf = new Map<number, number>();
  for (const x of loaded) if (x.category_id !== null) countOf.set(x.category_id, (countOf.get(x.category_id) ?? 0) + 1);
  const visible = selected !== null ? loaded.filter((x) => x.category_id === selected) : loaded;

  // What "Clear completed" removes is what the server will let this person remove, so the count says the same.
  const clearable = (all.data ?? []).filter((x) => x.status === "completed" && canChangeTask(user, x)).length;

  const groups: { key: DueGroup | "none"; tasks: Task[] }[] =
    status !== "completed" && !searching
      ? (["overdue", "today", "week", "later", "none"] as const)
          .map((key) => ({ key, tasks: visible.filter((x) => (x.due_date ? dueGroup(x.due_date, today) : "none") === key) }))
          .filter((g) => g.tasks.length > 0)
      : [{ key: "none", tasks: visible }];

  const searchBox = searchOpen && (
    <label className="tasks-toolbar__search">
      <span className="visually-hidden">{t("taskSearchLabel")}</span>
      <input type="search" value={text} autoFocus placeholder={t("taskSearchPlaceholder")} onChange={(e) => setText(e.target.value)} />
    </label>
  );
  const faces = showPeople && (
    <AvatarFilter people={selectable} selected={picked} onChange={setPicked} label={t("schWho")} everyoneLabel={t("everyone")}
      moreLabel={(count) => t("schWhoMore", { count })} max={narrow ? 3 : 6} size={narrow ? "sm" : "md"} />
  );
  // On a phone the category chips become a dropdown (like the Agenda's views), on the same line as the faces when they fit.
  const categoryOptions = (categories.data ?? []).filter((c) => (countOf.get(c.id) ?? 0) > 0 || c.id === selected);
  const categoryMenu = showChips && shown.data && (categories.data ?? []).length > 0 && (
    <Segmented dropdown label={t("taskCatFilter")} value={selected === null ? "all" : String(selected)} onChange={(v) => setPick(v === "all" ? null : Number(v))}
      options={[{ value: "all", label: `${t("taskCatAll")} ${loaded.length}` }, ...categoryOptions.map((c) => ({ value: String(c.id), label: `${c.icon ?? FALLBACK_CATEGORY_ICON} ${c.name} ${countOf.get(c.id) ?? 0}` }))]} />
  );

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
            <IconButton icon="search" label={t("taskSearchLabel")} aria-pressed={searchOpen} onClick={() => { setManaging(false); if (searchOpen) setText(""); setSearchOpen(!searchOpen); }} />
            <ViewMenuButton view={view} onView={setView} canManage={canManageCategories(user)}
              toggles={[
                { id: "categories", label: t("taskShowCategories"), checked: showChips, onChange: (on) => update({ show_task_categories: on }) },
                { id: "people", label: t("taskShowPeople"), checked: showPeople, onChange: (on) => update({ show_task_people: on }) },
              ]} managing={managing} onManage={() => { setSearchOpen(false); setText(""); setManaging(!managing); }}
              onClear={clearable > 0 && (view === "board" || status === "completed") && !searching ? () => setClearing(true) : undefined} />
            <IconButton icon="plus" variant="primary" label={t("taskNew")} onClick={() => setEditing("new")} />
          </>
        }
      />
      {managing ? <CategoryManager onClose={() => setManaging(false)} /> : noTasksAtAll ? (
        <EmptyArt art="tasks" title={t("taskEmpty")} hint={t("taskEmptyFun")}>
          <Button variant="primary" icon="plus" onClick={() => setEditing("new")}>{t("taskAddFirst")}</Button>
        </EmptyArt>
      ) : (
        <>
          <div className="tasks-toolbar">
            {narrow && searchBox}
            {!searching && view === "list" && <Segmented label={t("taskStatusLabel")} value={status} onChange={setStatus} options={STATUSES.map((s) => ({ value: s, label: t(STATUS_KEYS[s]) }))} />}
            {!narrow && searchBox}
            {narrow && (categoryMenu || faces) && <div className="tasks-toolbar__row">{categoryMenu}{faces}</div>}
            {!narrow && faces}
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
          {!narrow && showChips && shown.data && (categories.data ?? []).length > 0 && (
            <CategoryChips label={t("taskCatFilter")} allLabel={t("taskCatAll")} allCount={loaded.length}
              options={(categories.data ?? []).map((c) => ({ id: c.id, name: c.name, icon: c.icon, count: countOf.get(c.id) ?? 0 }))}
              selected={selected} onSelect={setPick} />
          )}
          {shown.isPending ? <Loading />
            : shown.isError ? <ErrorNotice error={shown.error} onRetry={() => void shown.refetch()} />
            : visible.length === 0 && searching ? <EmptyState>{t("taskSearchNoResults", { q: text.trim() })}</EmptyState>
            : visible.length === 0 && view === "list" ? <EmptyArt compact art="tasks" title={t(EMPTY_KEYS[status])} hint={t(EMPTY_FUN_KEYS[status])} />
            : (
              view === "board" ? (
                <TaskBoard tasks={visible} people={byId} categoryById={categoryById} today={today}
                  canMove={(x) => canSetTaskStatus(user, x)} narrow={narrow}
                  onMove={(x, to) => move.mutate({ task: x, status: to }, { onError: () => toast(t("taskMoveFailed")), onSuccess: () => narrow && toast(t("taskMovedTo", { status: t(STATUS_KEYS[to]) })) })} onOpen={setEditing} />
              ) : (
              <div className="taskgroups">
                {groups.map((g) => (
                  <section key={g.key} className="taskgroup">
                    {status !== "completed" && !searching && <h2 className="taskgroup__label">{t(GROUP_KEYS[g.key])}</h2>}
                    <ul className="tasks">{g.tasks.map(row)}</ul>
                  </section>
                ))}
              </div>
              ))}
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
