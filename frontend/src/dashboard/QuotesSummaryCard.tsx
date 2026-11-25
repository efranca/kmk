import { useTranslation } from "react-i18next";

import { useQuotes } from "../quotes/hooks";
import type { QuoteFilter } from "../quotes/types";
import { ErrorNotice, Loading } from "../ui/Feedback";
import { DashCard } from "./DashCard";

/** Admins only: what is waiting on the team, what waits on the customer, and what is past its 24 h deadline. Each number opens its tab. */
export function QuotesSummaryCard({ onOpenQuotes }: { onOpenQuotes: (tab?: QuoteFilter) => void }) {
  const { t } = useTranslation();
  const query = useQuotes("all");
  const counts = query.data?.counts;
  const needReply = (counts?.new ?? 0) + (counts?.customer_replied ?? 0);
  const waiting = counts?.replied ?? 0;
  const overdue = (query.data?.quotes ?? []).filter((q) => q.overdue).length;
  const state = query.isPending ? <Loading /> : query.isError ? <ErrorNotice error={query.error} onRetry={() => void query.refetch()} /> : null;
  const stat = (label: string, value: number, tab: QuoteFilter, late = false) => (
    <button type="button" className={late && value > 0 ? "dash__stat dash__stat--late" : "dash__stat"} onClick={() => onOpenQuotes(tab)}>
      <b>{value}</b>
      <span>{label}</span>
    </button>
  );
  return (
    <DashCard title={t("dashQuotesSummary")} href="/quotes" onOpen={() => onOpenQuotes()} state={state} empty={needReply === 0 && waiting === 0} emptyText={t("dashQuotesInboxZero")} art="quotes" emptyHint={t("dashQuotesInboxZeroFun")}>
      <div className="dash__stats">
        {stat(t("dashQuotesNeedReply"), needReply, "new")}
        {stat(t("dashQuotesWaiting"), waiting, "replied")}
        {stat(t("dashQuotesOverdue"), overdue, "new", true)}
      </div>
    </DashCard>
  );
}
