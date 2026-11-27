import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useRoute } from "../route";
import { IconButton } from "../ui/Button";
import { EmptyArt } from "../ui/EmptyArt";
import { EmptyState, ErrorNotice, Loading } from "../ui/Feedback";
import { PageHeader } from "../ui/PageHeader";
import { Segmented } from "../ui/Segmented";
import { fold } from "../person";
import { useQuotes } from "./hooks";
import { ManualQuoteDialog } from "./ManualQuoteDialog";
import { KIND_KEYS, STATUS_KEYS, TAB_KEYS, TABS } from "./labels";
import type { QuoteFilter, QuoteSummary } from "./types";

function matches(quote: QuoteSummary, query: string): boolean {
  const haystack = fold([quote.reference, quote.name, quote.email, quote.phone, quote.city].join(" "));
  return fold(query).split(" ").filter(Boolean).every((word) => haystack.includes(word));
}

/** The quote requests, newest first, with a tab per status and a search over the people and the places. */
export function QuotesPage() {
  const { t, i18n } = useTranslation();
  const { navigate, search } = useRoute();
  const [tab, setTab] = useState<QuoteFilter>(() => {
    const asked = new URLSearchParams(search).get("tab");
    return TABS.find((value) => value === asked) ?? "new";
  });
  const [text, setText] = useState("");
  const [entering, setEntering] = useState(false);
  const searching = text.trim().length > 0;
  const result = useQuotes(searching ? "all" : tab); // a search looks through every status
  const when = (iso: string) => new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  const rows = (result.data?.quotes ?? []).filter((q) => !searching || matches(q, text));

  return (
    <>
      <PageHeader title={t("quoteTitle")} actions={<IconButton icon="plus" variant="primary" label={t("quoteManualNew")} onClick={() => setEntering(true)} />} />
      <div className="quotes-toolbar">
        <div className="quotes-tabs">
          <Segmented label={t("quoteTabs")} value={tab} onChange={setTab} options={TABS.map((value) => ({ value, label: t(TAB_KEYS[value]) }))} />
        </div>
        <input type="search" className="input quotes-search" aria-label={t("quoteSearch")} placeholder={t("quoteSearchPlaceholder")} value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      {result.isPending ? <Loading /> : result.isError ? <ErrorNotice error={result.error} onRetry={() => void result.refetch()} /> : rows.length === 0 ? (
        searching ? <EmptyState>{t("quoteNoResults")}</EmptyState>
        : tab === "new" || tab === "all" ? <EmptyArt art="quotes" title={t(tab === "new" ? "quoteEmptyNewTitle" : "quoteEmptyTitle")} hint={t("quoteEmptyFun")} />
        : <EmptyState>{t("quoteEmpty")}</EmptyState>
      ) : (
        <ul className="quote-list">
          {rows.map((q) => (
            <li key={q.id}>
              <a className="quote-row" href={`/quotes/${q.id}`} onClick={(e) => { e.preventDefault(); navigate(`/quotes/${q.id}`); }}>
                <span className="quote-row__ref">{q.reference}</span>
                <span className="quote-row__main">
                  <b>{q.name}</b>
                  <small>{t(KIND_KEYS[q.kind])} · {q.city}</small>
                </span>
                <span className="quote-row__meta">
                  <span className={`quote-pill quote-pill--${q.status}`}>{t(STATUS_KEYS[q.status])}</span>
                  {q.overdue ? <span className="quote-late">{t("quoteOverdue")}</span> : q.status === "new" && <small>{t("quoteDue", { when: when(q.deadline_at) })}</small>}
                  {q.messages > 0 && <small>{t("quoteMessageCount", { count: q.messages })}</small>}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {entering && <ManualQuoteDialog onClose={() => setEntering(false)} onCreated={(id) => navigate(`/quotes/${id}`)} />}
    </>
  );
}
