import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useRoute } from "../route";
import { useSession } from "../session";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { ErrorNotice, Loading } from "../ui/Feedback";
import { Icon } from "../ui/Icon";
import { PageHeader } from "../ui/PageHeader";
import { useToast } from "../ui/toastContext";
import { pdfUrl } from "./api";
import { useCancelInvoice, useInvoice, useMarkUnpaid, usePurgeInvoice } from "./hooks";
import { formatDay, STATUS_KEYS } from "./labels";
import { formatMoney } from "./money";
import { PaidDialog } from "./PaidDialog";
import { SendDialog } from "./SendDialog";
import type { Invoice } from "./types";

const swallow = (p: Promise<unknown>) => void p.catch(() => undefined);

function Actions({ invoice }: { invoice: Invoice }) {
  const { t } = useTranslation();
  const toast = useToast();
  const unpay = useMarkUnpaid();
  const cancel = useCancelInvoice();
  const purge = usePurgeInvoice();
  const { navigate } = useRoute();
  const { user } = useSession();
  const [dialog, setDialog] = useState<"paid" | "send" | "cancel" | "purge" | null>(null);
  const live = invoice.status !== "cancelled";
  const failure = unpay.error ?? cancel.error;
  const canPurge = user.role === "superadmin" && !live;

  async function doCancel() {
    await cancel.mutateAsync(invoice.id);
    toast(t("invCancelDone"));
    setDialog(null);
  }

  async function doPurge() {
    await purge.mutateAsync(invoice.id);
    toast(t("invPurgeDone"));
    navigate("/invoices");
  }

  return (
    <div className="invoice-actions">
      <a className="btn btn--secondary" href={pdfUrl(invoice.id)} download><Icon name="download" /><span>{t("invDownload")}</span></a>
      {live && invoice.status === "unpaid" && <Button variant="primary" icon="check" onClick={() => setDialog("paid")}>{t("invMarkPaid")}</Button>}
      {live && invoice.status === "paid" && <Button icon="undo" busy={unpay.isPending} onClick={() => swallow(unpay.mutateAsync(invoice.id).then(() => toast(t("invUnpaidDone"))))}>{t("invMarkUnpaid")}</Button>}
      {live && <Button icon="send" onClick={() => setDialog("send")}>{t("invSend")}</Button>}
      {live && <Button variant="danger" icon="trash" onClick={() => setDialog("cancel")}>{t("invCancel")}</Button>}
      {canPurge && <Button variant="danger" icon="trash" onClick={() => setDialog("purge")}>{t("invPurge")}</Button>}
      {failure && <ErrorNotice error={failure} />}
      {dialog === "paid" && <PaidDialog invoiceId={invoice.id} onClose={() => setDialog(null)} />}
      {dialog === "send" && <SendDialog invoice={invoice} onClose={() => setDialog(null)} />}
      <Dialog
        open={dialog === "cancel"} title={t("invCancel")} onClose={() => setDialog(null)}
        footer={<><Button variant="ghost" onClick={() => setDialog(null)}>{t("invKeep")}</Button><Button variant="danger" icon="trash" busy={cancel.isPending} onClick={() => swallow(doCancel())}>{t("invCancelYes")}</Button></>}
      >
        <p>{t("invCancelConfirm", { ref: invoice.reference })}</p>
        {cancel.error && <ErrorNotice error={cancel.error} />}
      </Dialog>
      <Dialog
        open={dialog === "purge"} title={t("invPurge")} onClose={() => setDialog(null)}
        footer={<><Button variant="ghost" onClick={() => setDialog(null)}>{t("cancel")}</Button><Button variant="danger" icon="trash" busy={purge.isPending} onClick={() => swallow(doPurge())}>{t("invPurgeYes")}</Button></>}
      >
        <p>{t("invPurgeConfirm", { ref: invoice.reference })}</p>
        {purge.error && <ErrorNotice error={purge.error} />}
      </Dialog>
    </div>
  );
}

function Details({ invoice }: { invoice: Invoice }) {
  const { t, i18n } = useTranslation();
  const { navigate } = useRoute();
  const money = (v: string) => formatMoney(v, i18n.language);
  const sent = invoice.sent_at ? new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(invoice.sent_at)) : null;
  return (
    <section className="section quote-card invoice">
      <p className="invoice__status">
        <span className={`invoice-pill invoice-pill--${invoice.status}`}>{t(STATUS_KEYS[invoice.status])}</span>
        <span>{t("invIssuedOn", { date: formatDay(invoice.issued_on, i18n.language) })}</span>
        {invoice.paid_on && <span>{t("invPaidOn", { date: formatDay(invoice.paid_on, i18n.language) })}</span>}
        {sent && <span>{t("invSentOn", { date: sent })}</span>}
      </p>
      <h2>{t("invBilledTo")}</h2>
      <address className="invoice__billed">
        <b>{invoice.bill_name}</b>
        {invoice.bill_address && <span>{invoice.bill_address}</span>}
        {invoice.bill_city && <span>{invoice.bill_city}</span>}
        {invoice.bill_phone && <span>{invoice.bill_phone}</span>}
        {invoice.bill_email && <span>{invoice.bill_email}</span>}
      </address>
      {invoice.client_id !== null && (
        <p><a href={`/clients/${invoice.client_id}`} onClick={(e) => { e.preventDefault(); navigate(`/clients/${invoice.client_id}`); }}>{t("clientOpen", { name: invoice.bill_name })}</a></p>
      )}
      <table className="invoice-lines">
        <thead><tr><th scope="col">{t("invColDescription")}</th><th scope="col" className="invoice-lines__amount">{t("invColAmount")}</th></tr></thead>
        <tbody>
          {invoice.lines.map((line, n) => <tr key={n}><td>{line.description}</td><td className="invoice-lines__amount">{money(line.amount)}</td></tr>)}
        </tbody>
      </table>
      <dl className="invoice-totals">
        <div><dt>{t("invSubtotal")}</dt><dd>{money(invoice.subtotal)}</dd></div>
        <div><dt>{t("invTax")}</dt><dd>{money(invoice.tax)}</dd></div>
        <div><dt>{t("invExtra")}</dt><dd>{money(invoice.extra)}</dd></div>
        <div className="invoice-totals__total"><dt>{t("invTotal")}</dt><dd>{money(invoice.total)}</dd></div>
      </dl>
      <Actions invoice={invoice} />
    </section>
  );
}

/** One invoice: who it was billed to, its lines and totals, and what can be done with it. */
export function InvoicePage({ id }: { id: number }) {
  const { t } = useTranslation();
  const { navigate } = useRoute();
  const result = useInvoice(id);
  const invoice = result.data;
  return (
    <>
      <PageHeader
        title={invoice ? t("invNumber", { ref: invoice.reference }) : t("invTitle")}
        actions={<Button variant="ghost" icon="chev-left" onClick={() => navigate("/invoices")}>{t("invBack")}</Button>}
      />
      {result.isPending ? <Loading /> : result.isError || !invoice ? <ErrorNotice error={result.error} onRetry={() => void result.refetch()} /> : <Details invoice={invoice} />}
    </>
  );
}
