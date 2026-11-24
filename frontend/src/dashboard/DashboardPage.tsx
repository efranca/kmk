import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";

import type { User } from "../api";
import MfaBanner from "../MfaBanner";
import { displayName } from "../person";
import { useOccurrences, usePeople } from "../schedule/hooks";
import { COMPANY_TIME_ZONE, addDays, todayIn } from "../schedule/scheduleDates";
import type { Occurrence } from "../schedule/types";
import { ErrorNotice, Loading } from "../ui/Feedback";
import { AllEventsCard } from "./AllEventsCard";
import { usePreferences } from "../preferences";
import { MyEventsCard } from "./MyEventsCard";
import { TasksCard } from "./TasksCard";

/** Today and the next seven days. */
const DAYS_AHEAD = 7;

/** The home page: a greeting and two widgets over the shared calendar, "My events" and "All events". */
export function DashboardPage({ user, mfaEnabled, recoveryCodesLeft }: { user: User; mfaEnabled: boolean; recoveryCodesLeft: number | null }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { prefs } = usePreferences();
  const widgets = prefs.dashboard_widgets;
  const today = todayIn(COMPANY_TIME_ZONE);
  const range = useOccurrences(today, addDays(today, DAYS_AHEAD));
  const everyone = usePeople();
  const people = everyone.data ?? [];
  const byId = new Map(people.map((p) => [p.id, p]));

  const state = range.isPending ? <Loading /> : range.isError ? <ErrorNotice error={range.error} onRetry={() => void range.refetch()} /> : null;
  const openDay = (item: Occurrence) => navigate(`/schedule?view=day&date=${item.date}`);
  const openSchedule = () => navigate("/schedule");
  const openTasks = () => navigate("/tasks");
  const items = range.data ?? [];

  return (
    <div className="page page--dashboard">
      <h1>{t("welcome", { name: displayName(user) })}</h1>
      {recoveryCodesLeft !== null && <p className="notice" role="status">{t("codesRemaining", { count: recoveryCodesLeft })}</p>}
      {!mfaEnabled && <MfaBanner role={user.role} />}
      <div className="dash__grid">
        {widgets.my_events && <MyEventsCard items={items} userId={user.id} people={byId} today={today} locale={i18n.language} state={state} onOpen={openDay} onOpenSchedule={openSchedule} />}
        {widgets.all_events && <AllEventsCard items={items} everyone={people} today={today} locale={i18n.language} state={state} onOpen={openDay} onOpenSchedule={openSchedule} />}
        {widgets.my_tasks && <TasksCard userId={user.id} people={byId} today={today} onOpenTasks={openTasks} />}
      </div>
      {!widgets.my_events && !widgets.all_events && !widgets.my_tasks && (
        <p className="status">
          {t("dashAllHidden")}{" "}
          <a href="/settings" onClick={(e) => { e.preventDefault(); navigate("/settings"); }}>{t("dashAllHiddenLink")}</a>
        </p>
      )}
    </div>
  );
}
