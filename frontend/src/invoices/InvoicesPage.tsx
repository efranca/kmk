import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useRoute } from "../route";
import { useNarrow } from "../schedule/useNarrow";
import { IconButton } from "../ui/Button";
import { EmptyState, ErrorNotice, Loading } from "../ui/Feedback";
import { PageHeader } from "../ui/PageHeader";
import { Segmented } from "../ui/Segmented";
import { useInvoices } from "./hooks";
import { formatDay, STATUS_KEYS, TAB_KEYS, TABS, type InvoiceTab } from "./labels";
import { formatMoney } from "./money";

/** The invoices, newest first, with a tab per status, a search, and what is still unpaid on top. */
export function InvoicesPage() {
  const narrow = useNarrow();
  const { t, i18n } = useTranslation();
  const { navigate } = useRoute();
  const [tab, setTab] = useState<InvoiceTab>("all");
  const [text, setText] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const result = useInvoices(tab === "all" ? undefined : tab, text.trim());
  const rows = result.data?.invoices ?? [];

  return (
    <>
      <PageHeader title={t("invTitle")} actions={<IconButton icon="search" label={t("invSearch")} aria-pressed={searchOpen} onClick={() => { if (searchOpen) setText(""); setSearchOpen(!searchOpen); }} />} />
      <div className="quotes-toolbar">
        <div className="quotes-tabs">
          <Segmented dropdown={narrow} label={t("invTabs")} value={tab} onChange={setTab} options={TABS.map((value) => ({ value, label: t(TAB_KEYS[value]) }))} />
        </div>
        {searchOpen && (
          <label className="tasks-toolbar__search quotes-searchbox">
            <span className="visually-hidden">{t("invSearch")}</span>
            <input type="search" value={text} autoFocus placeholder={t("invSearchPlaceholder")} onChange={(e) => setText(e.target.value)} />
          </label>
        )}
      </div>
      {result.data && <p className="invoice-unpaid">{t("invUnpaidTotal", { amount: formatMoney(result.data.unpaid_total, i18n.language) })}</p>}
      {result.isPending ? <Loading /> : result.isError ? <ErrorNotice error={result.error} onRetry={() => void result.refetch()} /> : rows.length === 0 ? (
        <EmptyState>{text.trim() ? t("invNoResults") : t("invEmpty")}</EmptyState>
      ) : (
        <ul className="invoice-list">
          {rows.map((i) => (
            <li key={i.id}>
              <a className="invoice-row" href={`/invoices/${i.id}`} onClick={(e) => { e.preventDefault(); navigate(`/invoices/${i.id}`); }}>
                <span className="invoice-row__ref">{i.reference}</span>
                <span className="invoice-row__main">
                  <b>{i.bill_name}</b>
                  <small>{formatDay(i.issued_on, i18n.language)}</small>
                </span>
                <span className="invoice-row__meta">
                  <b>{formatMoney(i.total, i18n.language)}</b>
                  <span className={`invoice-pill invoice-pill--${i.status}`}>{t(STATUS_KEYS[i.status])}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
