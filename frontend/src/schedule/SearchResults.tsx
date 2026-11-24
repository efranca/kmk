import { useTranslation } from "react-i18next";

import { Avatar } from "../ui/Avatar";
import { EveryoneAvatar } from "../ui/AvatarGroup";
import { EmptyState, ErrorNotice, Loading } from "../ui/Feedback";
import { useOccurrences, usePeople } from "./hooks";
import { COMPANY_TIME_ZONE, addDays, todayIn } from "./scheduleDates";
import type { Occurrence } from "./types";

interface SearchResultsProps {
  query: string;
  locale: string;
  onOpen: (item: Occurrence) => void;
}

/** Events that match the search text, from three months back to ten months ahead; clicking one opens its day. */
export function SearchResults({ query, locale, onOpen }: SearchResultsProps) {
  const { t } = useTranslation();
  const today = todayIn(COMPANY_TIME_ZONE);
  const results = useOccurrences(addDays(today, -90), addDays(today, 300), { q: query });
  const people = usePeople();
  const byId = new Map((people.data ?? []).map((p) => [p.id, p]));
  const date = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", year: "numeric" });

  return (
    <section className="search" role="region" aria-label={t("schSearchResults")}>
      {results.isPending ? (
        <Loading />
      ) : results.isError ? (
        <ErrorNotice error={results.error} onRetry={() => void results.refetch()} />
      ) : results.data.length === 0 ? (
        <EmptyState>{t("schNoResults", { q: query })}</EmptyState>
      ) : (
        <ul className="search__list">
          {results.data.map((item) => {
            const who = item.people.map((id) => byId.get(id)).filter((p) => p !== undefined);
            return (
              <li key={`${item.event_id}-${item.original_date}`}>
                <button type="button" className="search__row" onClick={() => onOpen(item)}>
                  <span className="search__when">
                    <b>{date.format(new Date(`${item.date}T12:00:00`))}</b>
                    <small>{item.all_day ? t("schAllDay") : item.start_time}</small>
                  </span>
                  <span className="search__title">{item.icon && <span aria-hidden="true">{item.icon} </span>}{item.title}</span>
                  <span className="search__who">
                    {who.length > 0 ? who.map((p) => <Avatar key={p.id} person={p} size="sm" labelled />) : <EveryoneAvatar />}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
