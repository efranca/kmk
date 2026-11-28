import { useTranslation } from "react-i18next";

import { useRoute } from "../route";
import { EmptyState, ErrorNotice, Loading } from "../ui/Feedback";
import { PageHeader } from "../ui/PageHeader";
import { useVisit, useVisitsToday } from "./hooks";
import { companyToday, formatDay, visitError } from "./labels";
import { VisitCard } from "./VisitCard";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** `?event=3&date=2026-11-27`: one visit of another day (a forgotten check-out to correct), opened from the Agenda. */
function linkedVisit(search: string): { eventId: number; occurrenceDate: string } | null {
  const params = new URLSearchParams(search);
  const eventId = Number(params.get("event"));
  const occurrenceDate = params.get("date") ?? "";
  return Number.isInteger(eventId) && eventId > 0 && ISO_DAY.test(occurrenceDate) ? { eventId, occurrenceDate } : null;
}

function LinkedVisit({ eventId, occurrenceDate }: { eventId: number; occurrenceDate: string }) {
  const { t } = useTranslation();
  const result = useVisit(eventId, occurrenceDate);
  if (result.isPending) return <Loading />;
  if (result.isError) return <div className="notice notice--error" role="alert"><p>{visitError(result.error, t)}</p></div>;
  return <VisitCard visit={result.data} showDate />;
}

/** "Visits today": the visits of the day that list me, one card each (phone first). */
export function VisitsTodayPage() {
  const { t, i18n } = useTranslation();
  const { search } = useRoute();
  const linked = linkedVisit(search);
  const result = useVisitsToday();
  const visits = (result.data ?? []).filter((v) => !(linked && v.event_id === linked.eventId && v.occurrence_date === linked.occurrenceDate));

  return (
    <div className="visits-page">
      <PageHeader title={t("visTitle")} />
      {linked && (
        <section className="visits-page__section">
          <LinkedVisit {...linked} />
        </section>
      )}
      <section className="visits-page__section" aria-labelledby="visits-today">
        <h2 id="visits-today" className="visits-page__day">
          {t("visToday")} <small>{formatDay(companyToday(), i18n.language)}</small>
        </h2>
        {result.isPending ? <Loading /> : result.isError ? <ErrorNotice error={result.error} onRetry={() => void result.refetch()} /> : visits.length === 0 ? (
          <EmptyState>{t("visNone")}</EmptyState>
        ) : (
          <ul className="visits-list">
            {visits.map((v) => (
              <li key={`${v.event_id}-${v.occurrence_date}`}>
                <VisitCard visit={v} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
