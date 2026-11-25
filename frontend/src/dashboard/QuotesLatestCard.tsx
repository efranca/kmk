import { useTranslation } from "react-i18next";

import { useQuotes } from "../quotes/hooks";
import { KIND_KEYS, STATUS_KEYS } from "../quotes/labels";
import { ErrorNotice, Loading } from "../ui/Feedback";
import { DashCard } from "./DashCard";

const LATEST = 5;

/** "2 hours ago", in the person's language. */
function ago(iso: string, locale: string): string {
  const minutes = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (Math.abs(minutes) < 60) return format.format(minutes, "minute");
  if (Math.abs(minutes) < 60 * 24) return format.format(Math.round(minutes / 60), "hour");
  return format.format(Math.round(minutes / (60 * 24)), "day");
}

/** Admins only: the five newest quote requests. A row opens the quote, the title opens the list. */
export function QuotesLatestCard({ onOpenQuote, onOpenQuotes, locale }: { onOpenQuote: (id: number) => void; onOpenQuotes: () => void; locale: string }) {
  const { t } = useTranslation();
  const query = useQuotes("all");
  const rows = (query.data?.quotes ?? []).slice(0, LATEST);
  const state = query.isPending ? <Loading /> : query.isError ? <ErrorNotice error={query.error} onRetry={() => void query.refetch()} /> : null;
  return (
    <DashCard title={t("dashQuotesLatest")} href="/quotes" onOpen={onOpenQuotes} state={state} empty={rows.length === 0} emptyText={t("dashQuotesLatestEmpty")} art="quotes" emptyHint={t("dashQuotesLatestFun")}>
      <ul className="dash__quotes">
        {rows.map((q) => (
          <li key={q.id}>
            <a href={`/quotes/${q.id}`} className="dash__quote" onClick={(e) => { e.preventDefault(); onOpenQuote(q.id); }}>
              <span className="dash__quote-main">
                <b>{q.name}</b>
                <small>{q.reference} · {t(KIND_KEYS[q.kind])} · {q.city}</small>
              </span>
              <span className="dash__quote-meta">
                <span className={`quote-pill quote-pill--${q.status}`}>{t(STATUS_KEYS[q.status])}</span>
                {q.overdue && <span className="quote-late">{t("quoteOverdue")}</span>}
                <small>{ago(q.submitted_at, locale)}</small>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </DashCard>
  );
}
