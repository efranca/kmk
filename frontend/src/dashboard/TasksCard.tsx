import { useTranslation } from "react-i18next";

import { addDays } from "../schedule/scheduleDates";
import { useSession } from "../session";
import { useCategories, useTasks, useToggleTask } from "../tasks/hooks";
import { canSetTaskStatus } from "../tasks/permissions";
import { TaskRow } from "../tasks/TaskRow";
import type { Task } from "../tasks/types";
import type { Person } from "../ui/Avatar";
import { ErrorNotice, Loading } from "../ui/Feedback";
import { DashCard } from "./DashCard";
import { myTaskSections } from "./myTasks";

const MAX_NOW = 6; // overdue, today and finished today share these rows
const MAX_OTHER = 3; // each of "no date" and "tomorrow"

/** Rows are taken from the sections in order until the budget is spent; the rest is only counted. */
function take(budget: number, ...lists: Task[][]): { shown: Task[][]; hidden: number } {
  let left = budget;
  let hidden = 0;
  const shown = lists.map((list) => {
    const part = list.slice(0, left);
    left -= part.length;
    hidden += list.length - part.length;
    return part;
  });
  return { shown, hidden };
}

/** The signed-in person's tasks (theirs and the whole team's): overdue, today, with no date, tomorrow. Tick them right here. */
export function TasksCard({ userId, people, today, onOpenTasks }: { userId: number; people: ReadonlyMap<number, Person>; today: string; onOpenTasks: () => void }) {
  const { t } = useTranslation();
  const { user } = useSession();
  const query = useTasks("all");
  const { data: categories = [] } = useCategories();
  const toggle = useToggleTask();
  const tomorrow = addDays(today, 1);
  const sections = myTaskSections(query.data ?? [], userId, today, tomorrow);
  const byCategory = new Map(categories.map((c) => [c.id, c]));

  const now = take(MAX_NOW, sections.overdue, sections.today, sections.doneToday);
  const noDate = take(MAX_OTHER, sections.noDate);
  const next = take(MAX_OTHER, sections.tomorrow);
  const hidden = now.hidden + noDate.hidden + next.hidden;
  const empty = Object.values(sections).every((list) => list.length === 0);
  const [overdue, open, done] = now.shown as [Task[], Task[], Task[]];

  const rows = (list: Task[]) => (
    <ul className="tasks">
      {list.map((task) => (
        <TaskRow key={task.id} task={task} people={people} category={task.category_id ? byCategory.get(task.category_id) : undefined} today={today}
          canToggle={canSetTaskStatus(user, task)} onToggle={() => toggle.mutate(task)} onOpen={onOpenTasks} />
      ))}
    </ul>
  );
  const section = (title: string, list: Task[]) => list.length > 0 && (
    <div className="dash__group">
      <h3 className="dash__heading">{title}</h3>
      {rows(list)}
    </div>
  );

  const state = query.isPending ? <Loading /> : query.isError ? <ErrorNotice error={query.error} onRetry={() => void query.refetch()} /> : null;
  return (
    <DashCard title={t("dashMyTasks")} href="/tasks" onOpen={onOpenTasks} state={state} empty={empty} emptyText={t("taskDashEmpty")} art="tasks" emptyHint={t("taskDashEmptyFun")}>
      {section(t("taskGroupOverdue"), overdue)}
      {section(t("taskGroupToday"), [...open, ...done])}
      {section(t("taskGroupNone"), noDate.shown[0]!)}
      {section(t("taskDashTomorrow"), next.shown[0]!)}
      {hidden > 0 && <button type="button" className="dash__more" onClick={onOpenTasks}>{t("taskDashMore", { count: hidden })}</button>}
    </DashCard>
  );
}
