import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { IconButton } from "../ui/Button";
import { EventDialog, type EventDialogTarget } from "./EventDialog";
import { ErrorNotice, Loading } from "../ui/Feedback";
import { PageHeader } from "../ui/PageHeader";
import { peopleInCommon } from "../ui/peopleInCommon";
import { usePreferences } from "../preferences";
import { useSession } from "../session";
import { ViewMenuButton } from "../tasks/ViewMenuButton";
import { TaskDialog } from "../tasks/TaskDialog";
import { useTasks, useToggleTask } from "../tasks/hooks";
import { canSetTaskStatus } from "../tasks/permissions";
import type { Task } from "../tasks/types";
import { useOccurrences, usePeople } from "./hooks";
import { canChangeEvent } from "./permissions";
import { MonthView } from "./MonthView";
import { COMPANY_TIME_ZONE, addDays, firstDayOf, todayIn, weekStart } from "./scheduleDates";
import { ScheduleToolbar } from "./ScheduleToolbar";
import { SearchResults } from "./SearchResults";
import { tasksByDate, useShowTasks } from "./taskItems";
import { shiftDate, useScheduleView, visibleRange, type ScheduleViewKind } from "./scheduleView";
import { TimeGrid } from "./TimeGrid";
import { useMoveEvent } from "./useMoveEvent";
import { useSwipe } from "./useSwipe";
import type { Occurrence } from "./types";
import { useNarrow } from "./useNarrow";
import { YearView } from "./YearView";

/** What the view covers, written for the person: "Thursday, November 12", "Nov 8 – 14", "November 2026". */
function rangeLabel(view: ScheduleViewKind, date: string, days: string[], locale: string): string {
  const day = (d: string) => new Date(`${d}T12:00:00`);
  switch (view) {
    case "day": return new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric" }).format(day(date));
    case "week": return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).formatRange(day(days[0]!), day(days[days.length - 1]!));
    case "month": return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(day(date));
    case "year": return date.slice(0, 4);
  }
}

/** The shared calendar: Day, Week, Month and Year views; an event or an empty spot opens the event dialog. */
export function SchedulePage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const { view, date, people: pickedInUrl, q, today, set } = useScheduleView();
  const { user } = useSession();
  const { prefs, update } = usePreferences();
  const isStaff = user.role === "user";
  const showPeople = isStaff || prefs.show_schedule_people; // Staff always have their faces; admins can hide them (hidden faces cannot filter, so every event shows)
  const people = showPeople ? pickedInUrl : [];
  const narrow = useNarrow();
  const moveEvent = useMoveEvent();
  const everyone = usePeople();
  const [searchOpen, setSearchOpen] = useState(q.length > 0);
  const [dialog, setDialog] = useState<EventDialogTarget | null>(null);
  const onOpenEvent = (item: Occurrence) => setDialog({ kind: "item", item });
  const onCreate = (day: string, minutes?: number) => setDialog({ kind: "new", date: day, minutes });
  const firstDay = firstDayOf(i18n.language);

  const [from, to] = visibleRange(view, date, firstDay, narrow);
  const range = useOccurrences(from, to, { people });
  // Staff only get the faces of the people they share an event with: read from the range without the people filter, so picking a face does not shrink the list.
  const unfiltered = useOccurrences(from, to, { enabled: isStaff });
  const faces = (everyone.data ?? []).filter((p) => p.active !== false);
  // Tasks with a due date are only asked for, and drawn, while the switch is on.
  const [showTasks, setShowTasks] = useShowTasks();
  const allTasks = useTasks("all", undefined, showTasks);
  const toggleTask = useToggleTask();
  const [openTask, setOpenTask] = useState<Task | null>(null);
  const dueTasks = useMemo(() => (showTasks ? tasksByDate(allTasks.data ?? [], from, to, people) : new Map<string, Task[]>()), [showTasks, allTasks.data, from, to, people]);
  const taskLayer = showTasks
    ? { on: (date: string) => dueTasks.get(date) ?? [], canToggle: (task: Task) => canSetTaskStatus(user, task), onToggle: (task: Task) => toggleTask.mutate(task), onOpen: setOpenTask }
    : undefined;
  const busyDates = useMemo(() => new Set([...(range.data ?? []).map((o) => o.date), ...dueTasks.keys()]), [range.data, dueTasks]);

  // The search box keeps its own text and writes it to the URL a moment after typing stops.
  const [text, setText] = useState(q);
  useEffect(() => {
    const id = setTimeout(() => {
      if (text.trim() !== q) set({ q: text.trim() });
    }, 300);
    return () => clearTimeout(id);
  }, [text, q, set]);
  const searching = q.length >= 2;

  const swipe = useSwipe(() => set({ date: shiftDate(view, date, -1, narrow) }), () => set({ date: shiftDate(view, date, 1, narrow) }));

  const gridDays = view === "day" ? [date] : narrow ? [0, 1, 2].map((n) => addDays(date, n)) : Array.from({ length: 7 }, (_, n) => addDays(weekStart(date, firstDay), n));

  return (
    <div className="page page--schedule">
      <PageHeader
        title={t("schTitle")}
        actions={
          <>
            <IconButton
              icon="search"
              label={t("schSearchLabel")}
              aria-pressed={searchOpen}
              onClick={() => {
                if (searchOpen) setText("");
                setSearchOpen(!searchOpen);
              }}
            />
            <ViewMenuButton views={[]} canManage={false} managing={false} menuLabel={t("schOptions")}
              toggles={[
                { id: "tasks", label: t("schShowTasks"), checked: showTasks, onChange: setShowTasks },
                ...(isStaff ? [] : [{ id: "people", label: t("schShowPeople"), checked: showPeople, onChange: (on: boolean) => update({ show_schedule_people: on }) }]),
              ]} />
            <IconButton icon="plus" variant="primary" label={t("schAdd")} onClick={() => onCreate(view === "day" ? date : today)} />
          </>
        }
      />
      <ScheduleToolbar
        view={view}
        date={date}
        people={people}
        everyone={isStaff ? peopleInCommon(faces, (unfiltered.data ?? []).map((o) => o.people), user.id, pickedInUrl) : faces}
        label={rangeLabel(view, date, view === "week" ? [from, to] : gridDays, locale)}
        onView={(next) => set({ view: next })}
        onDate={(next) => set({ date: next })}
        onToday={() => set({ date: todayIn(COMPANY_TIME_ZONE) })}
        onPeople={(ids) => set({ people: ids })}
        narrow={narrow}
        search={text}
        onSearch={setText}
        searchOpen={searchOpen}
        showPeople={showPeople}
      />
      <div className="sched-swipe" {...swipe}>
        {searching ? (
          <SearchResults
            query={q}
            locale={locale}
            onOpen={(item) => {
              setText("");
              set({ view: "day", date: item.date, q: "" });
            }}
          />
        ) : range.isPending ? (
          <Loading />
        ) : range.isError ? (
          <ErrorNotice error={range.error} onRetry={() => void range.refetch()} />
        ) : view === "year" ? (
          <YearView year={Number(date.slice(0, 4))} busyDates={busyDates} today={today} firstDay={firstDay} locale={locale} onOpenMonth={(first) => set({ view: "month", date: first })} />
        ) : view === "month" ? (
          <MonthView year={Number(date.slice(0, 4))} month={Number(date.slice(5, 7))} items={range.data} today={today} firstDay={firstDay} locale={locale} onOpenDay={(day) => set({ view: "day", date: day })} onOpenItem={onOpenEvent} tasks={taskLayer} />
        ) : (
          <TimeGrid days={gridDays} items={range.data} today={today} locale={locale} onOpenItem={onOpenEvent} onCreateAt={(day, minutes) => onCreate(day, minutes)}
            canMove={(item) => canChangeEvent(user, item)} onMoveEvent={(item, slot) => void moveEvent.move(item, slot)} tasks={taskLayer} />
        )}
      </div>
      {moveEvent.dialog}
      {openTask && <TaskDialog key={openTask.id} task={openTask} defaultPeople={[]} onClose={() => setOpenTask(null)} />}
      {dialog && <EventDialog key={dialog.kind === "item" ? `${dialog.item.event_id}-${dialog.item.original_date}` : `new-${dialog.date}-${dialog.minutes ?? ""}`} target={dialog} onClose={() => setDialog(null)} />}
    </div>
  );
}
