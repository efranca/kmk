import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useRoute } from "../route";
import { addDays, diffDays } from "../schedule/scheduleDates";
import { IconButton } from "../ui/Button";
import { EmptyState, Loading } from "../ui/Feedback";
import { TextField } from "../ui/Field";
import { Icon } from "../ui/Icon";
import { PageHeader } from "../ui/PageHeader";
import { visitLink } from "./AgendaVisit";
import { reportCsvUrl, type ReportLine } from "./api";
import { useVisitReport, useVisitReportPerson } from "./hooks";
import { companyToday, formatDay, visitError } from "./labels";

/** The default range: the last 14 days, today included (company time). */
export const REPORT_DEFAULT_DAYS = 14;
/** The server's limit: at most 366 days, both ends included. */
export const REPORT_MAX_DAYS = 366;

/** What is wrong with a range (a locale key), or null when the server would accept it. */
export function rangeProblem(from: string, to: string): string | null {
  if (!from || !to) return "visRangeMissing";
  if (from > to) return "visRangeInvalid";
  if (diffDays(from, to) > REPORT_MAX_DAYS - 1) return "visRangeTooLong";
  return null;
}

const place = (client: string | null, property: string | null) => [client, property].filter(Boolean).join(" · ");

/** A link that stays in the app (the visit page opens that visit of any day). */
function VisitLink({ eventId, occurrenceDate }: { eventId: number; occurrenceDate: string }) {
  const { t } = useTranslation();
  const { navigate } = useRoute();
  const to = visitLink(eventId, occurrenceDate);
  return <a className="visits-report__open-link" href={to} onClick={(e) => { e.preventDefault(); navigate(to); }}>{t("visOpenVisit")}</a>;
}

function ErrorLine({ error }: { error: unknown }) {
  const { t } = useTranslation();
  return <div className="notice notice--error" role="alert"><p>{visitError(error, t)}</p></div>;
}

/** One person's visits of the range: day, client and property, photos, markers; check-in and check-out as proof only. */
function PersonVisits({ person, from, to, onClose }: { person: { id: number; name: string }; from: string; to: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const result = useVisitReportPerson(person.id, from, to);
  useEffect(() => heading.current?.focus(), [person.id]);

  const proof = (line: ReportLine) =>
    [line.checked_in_at && t("visReportIn", { time: line.checked_in_at }), line.closed_at && t("visReportOut", { time: line.closed_at }), line.checked_in_by_name && line.checked_in_by_name !== person.name && t("visReportMarkedBy", { name: line.checked_in_by_name })]
      .filter(Boolean)
      .join(" · ");

  return (
    <section id="visits-report-detail" className="visits-report__detail" aria-labelledby={headingId}>
      <div className="visits-report__detail-head">
        <h2 id={headingId} ref={heading} tabIndex={-1}>{t("visReportOf", { name: person.name })}</h2>
        <IconButton icon="x" label={t("close")} onClick={onClose} />
      </div>
      {result.isPending ? <Loading /> : result.isError ? <ErrorLine error={result.error} /> : result.data.length === 0 ? (
        <EmptyState>{t("visReportNoVisits")}</EmptyState>
      ) : (
        <ul className="visits-report__lines">
          {result.data.map((line, i) => (
            <li key={`${line.event_id}-${line.occurrence_date}-${i}`} className="visits-report__line">
              <div className="visits-report__line-head">
                <b>{formatDay(line.date, i18n.language)}</b>
                <span className="visit-card__badges">
                  {line.corrected && <span className="visit-state visit-state--corrected">{t("visCorrected")}</span>}
                  {line.without_photos && <span className="visit-state visit-state--warn">{t("visClosedWithoutPhotos")}</span>}
                </span>
              </div>
              {place(line.client_name, line.property_name) && <span>{place(line.client_name, line.property_name)}</span>}
              <span className="visits-report__muted">{t("visReportPhotos", { count: line.photos })}</span>
              {proof(line) && <span className="visits-report__muted">{proof(line)}</span>}
              {line.event_id !== null && <VisitLink eventId={line.event_id} occurrenceDate={line.occurrence_date} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** "Visits done" (admins and the super admin): how many visits each person did in a range, to pay them. */
export function VisitsReportPage() {
  const { t, i18n } = useTranslation();
  const openId = useId();
  const [today] = useState(companyToday);
  const [from, setFrom] = useState(() => addDays(today, -(REPORT_DEFAULT_DAYS - 1)));
  const [to, setTo] = useState(today);
  const [person, setPerson] = useState<{ id: number; name: string } | null>(null);
  const problem = rangeProblem(from, to);
  const report = useVisitReport(from, to, problem === null);
  const people = report.data?.people ?? [];
  const open = report.data?.open ?? [];

  const exportLink = problem === null && (
    <a className="btn btn--secondary" href={reportCsvUrl(from, to)} download>
      <Icon name="download" />
      <span>{t("visExportCsv")}</span>
    </a>
  );

  return (
    <div className="visits-report">
      <PageHeader title={t("visReportTitle")} actions={exportLink || undefined} />
      <div className="visits-report__range">
        <TextField label={t("visRangeFrom")} type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        <TextField label={t("visRangeTo")} type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
      </div>
      <p className="visit-hint">{t("visReportProof")}</p>
      {problem !== null ? (
        <div className="notice notice--error" role="alert"><p>{t(problem)}</p></div>
      ) : report.isPending ? (
        <Loading />
      ) : report.isError ? (
        <ErrorLine error={report.error} />
      ) : (
        <>
          {people.length === 0 ? (
            <EmptyState>{t("visReportEmpty")}</EmptyState>
          ) : (
            <div className="visits-report__table">
              <table>
                <thead>
                  <tr>
                    <th scope="col">{t("visPerson")}</th>
                    <th scope="col">{t("visReportCount")}</th>
                    <th scope="col">{t("visReportCorrected")}</th>
                    <th scope="col">{t("visReportWithoutPhotos")}</th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((p, i) => {
                    const chosen = p.user_id !== null && person?.id === p.user_id;
                    return (
                      <tr key={p.user_id ?? `gone-${i}`} className={chosen ? "is-chosen" : undefined}>
                        <th scope="row">
                          {p.user_id === null ? p.name : (
                            <button type="button" className="visits-report__person" aria-expanded={chosen} aria-controls={chosen ? "visits-report-detail" : undefined} onClick={() => setPerson(chosen ? null : { id: p.user_id!, name: p.name })}>
                              {p.name}
                            </button>
                          )}
                        </th>
                        <td>{p.visits}</td>
                        <td className={p.corrected ? "is-marked" : undefined}>{p.corrected}</td>
                        <td className={p.without_photos ? "is-marked" : undefined}>{p.without_photos}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {person && <PersonVisits person={person} from={from} to={to} onClose={() => setPerson(null)} />}
          {open.length > 0 && (
            <section className="visits-report__open" aria-labelledby={openId}>
              <h2 id={openId}>{t("visOpenVisits")}</h2>
              <p className="visit-hint">{t("visOpenVisitsHint")}</p>
              <ul className="visits-report__lines">
                {open.map((v, i) => (
                  <li key={`${v.event_id}-${v.occurrence_date}-${i}`} className="visits-report__line">
                    <b>{formatDay(v.date, i18n.language)}</b>
                    {place(v.client_name, v.property_name) && <span>{place(v.client_name, v.property_name)}</span>}
                    <span className="visits-report__muted">{v.people.join(", ")}</span>
                    {v.event_id !== null && <VisitLink eventId={v.event_id} occurrenceDate={v.occurrence_date} />}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
