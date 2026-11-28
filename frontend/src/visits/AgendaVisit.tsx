import { useTranslation } from "react-i18next";

import { useRoute } from "../route";
import { useVisit } from "./hooks";
import { STATE_KEYS } from "./labels";

/** Where one visit is opened: `/visits` shows that visit of any day above today's list. */
export const visitLink = (eventId: number, occurrenceDate: string) => `/visits?${new URLSearchParams({ event: String(eventId), date: occurrenceDate })}`;

/**
 * In the Agenda item's dialog (an item with a property): the visit's state and a link to its check-in. The server
 * decides who may see the visit; one that is hidden or missing (404), or that fails to load, shows nothing at all.
 */
export function AgendaVisit({ eventId, occurrenceDate, onNavigate }: { eventId: number; occurrenceDate: string; onNavigate?: () => void }) {
  const { t } = useTranslation();
  const { navigate } = useRoute();
  const { data: visit } = useVisit(eventId, occurrenceDate);
  if (!visit) return null;
  const to = visitLink(eventId, occurrenceDate);
  return (
    <section className="agenda-visit" aria-label={t("visVisit")}>
      <span className="visit-card__badges">
        <span className={`visit-state visit-state--${visit.state}`}>{t(STATE_KEYS[visit.state])}</span>
        {visit.corrected && <span className="visit-state visit-state--corrected">{t("visCorrected")}</span>}
      </span>
      <a className="btn btn--primary" href={to} onClick={(e) => { e.preventDefault(); onNavigate?.(); navigate(to); }}>
        <span>{t("visOpenVisit")}</span>
      </a>
    </section>
  );
}
