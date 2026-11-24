import { useTranslation } from "react-i18next";

import type { Occurrence } from "../schedule/types";
import type { Person } from "../ui/Avatar";
import { Avatar } from "../ui/Avatar";
import { EveryoneAvatar } from "../ui/AvatarGroup";
import { DashCard, dayLabelFor } from "./DashCard";
import { EventRow } from "./EventRow";
import { groupByPerson } from "./groupByPerson";

const MAX_PER_GROUP = 4;

/** Everyone's events for today and the days to come: first the ones for everyone, then one group per person. */
export function AllEventsCard({
  items,
  everyone: allPeople,
  today,
  locale,
  state,
  onOpen,
  onOpenSchedule,
}: {
  items: Occurrence[];
  everyone: Person[];
  today: string;
  locale: string;
  state: React.ReactNode | null;
  onOpen: (item: Occurrence) => void;
  onOpenSchedule: () => void;
}) {
  const { t } = useTranslation();
  const { everyone, byPerson } = groupByPerson(items, allPeople);
  const byId = new Map(allPeople.map((p) => [p.id, p]));
  const list = (occurrences: Occurrence[]) => (
    <>
      <ul className="dash__list">
        {occurrences.slice(0, MAX_PER_GROUP).map((o) => (
          <EventRow key={`${o.event_id}-${o.original_date}`} item={o} people={byId} showFaces={false} onOpen={onOpen} dayLabel={dayLabelFor(o.date, today, locale, t("dashToday"))} />
        ))}
      </ul>
      {occurrences.length > MAX_PER_GROUP && (
        <button type="button" className="dash__more" onClick={onOpenSchedule}>{t("schMore", { n: occurrences.length - MAX_PER_GROUP })}</button>
      )}
    </>
  );
  return (
    <DashCard title={t("dashAllEvents")} onOpen={onOpenSchedule} state={state} empty={everyone.length === 0 && byPerson.length === 0}>
      {everyone.length > 0 && (
        <div className="dash__group" role="group" aria-label={t("everyone")}>
          <h3 className="dash__heading"><EveryoneAvatar size="sm" /> {t("everyone")}</h3>
          {list(everyone)}
        </div>
      )}
      {byPerson.map(({ person, occurrences }) => (
        <div key={person.id} className="dash__group" role="group" aria-label={person.name}>
          <h3 className="dash__heading"><Avatar person={person} size="sm" muted={person.active === false} /> {person.name}</h3>
          {list(occurrences)}
        </div>
      ))}
    </DashCard>
  );
}
