import { useTranslation } from "react-i18next";

import type { Occurrence } from "../schedule/types";
import type { Person } from "../ui/Avatar";
import { EventRow } from "./EventRow";
import { DashCard, dayLabelFor } from "./DashCard";

const MAX_UPCOMING = 6;

/** The signed-in person's events (the ones they are on, and the ones for everyone): today, then the days to come. */
export function MyEventsCard({
  items,
  userId,
  people,
  today,
  locale,
  state,
  onOpen,
  onOpenSchedule,
}: {
  items: Occurrence[];
  userId: number;
  people: ReadonlyMap<number, Person>;
  today: string;
  locale: string;
  state: React.ReactNode | null;
  onOpen: (item: Occurrence) => void;
  onOpenSchedule: () => void;
}) {
  const { t } = useTranslation();
  const mine = items.filter((o) => o.people.length === 0 || o.people.includes(userId));
  const now = mine.filter((o) => o.date === today);
  const later = mine.filter((o) => o.date > today);
  const row = (item: Occurrence, withDay: boolean) => (
    <EventRow key={`${item.event_id}-${item.original_date}`} item={item} people={people} onOpen={onOpen} dayLabel={withDay ? dayLabelFor(item.date, today, locale, t("dashToday")) : undefined} />
  );
  return (
    <DashCard title={t("dashMyEvents")} onOpen={onOpenSchedule} state={state} empty={mine.length === 0} art="events" emptyHint={t("dashEmptyFun")}>
      {now.length > 0 && (
        <>
          <h3 className="dash__heading">{t("dashToday")}</h3>
          <ul className="dash__list" aria-label={t("dashToday")}>{now.map((o) => row(o, false))}</ul>
        </>
      )}
      {later.length > 0 && (
        <>
          <h3 className="dash__heading">{t("dashUpcoming")}</h3>
          <ul className="dash__list" aria-label={t("dashUpcoming")}>{later.slice(0, MAX_UPCOMING).map((o) => row(o, true))}</ul>
          {later.length > MAX_UPCOMING && (
            <button type="button" className="dash__more" onClick={onOpenSchedule}>{t("schMore", { n: later.length - MAX_UPCOMING })}</button>
          )}
        </>
      )}
    </DashCard>
  );
}
