import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useRoute } from "../route";
import { useSession } from "../session";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { ErrorNotice, Loading } from "../ui/Feedback";
import { TextAreaField } from "../ui/Field";
import { PageHeader } from "../ui/PageHeader";
import { useToast } from "../ui/toastContext";
import { photoUrl } from "./api";
import { Conversation } from "./Conversation";
import { useDeleteQuote, useQuote, useUpdateQuote } from "./hooks";
import { FREQUENCY_KEYS, KIND_KEYS, LOCALE_NAMES, PROPERTY_KEYS, STATUS_KEYS } from "./labels";
import type { QuoteDetail, QuoteStatus } from "./types";

const STATUSES: QuoteStatus[] = ["new", "replied", "customer_replied", "won", "lost"];
const swallow = (p: Promise<unknown>) => void p.catch(() => undefined);

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <><dt>{label}</dt><dd>{children}</dd></>;
}

function Request({ quote }: { quote: QuoteDetail }) {
  const { t, i18n } = useTranslation();
  const d = quote.details;
  const when = (iso: string) => new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  const place = [quote.geo_city, quote.geo_country].filter(Boolean).join(", ");
  return (
    <section className="section quote-card">
      <h2>{t("quoteRequest")}</h2>
      <dl className="quote-facts">
        <Row label={t("quoteEmail")}><a href={`mailto:${quote.email}`}>{quote.email}</a></Row>
        <Row label={t("quotePhone")}><a href={`tel:${quote.phone.replace(/[^\d+]/g, "")}`}>{quote.phone}</a></Row>
        <Row label={t("quoteType")}>{t(KIND_KEYS[quote.kind])}</Row>
        <Row label={t("quoteCity")}>{d.city}</Row>
        <Row label={t("quoteAddress")}>{d.address ?? d.city}</Row>
        {d.property && <Row label={t("quoteProperty")}>{t(PROPERTY_KEYS[d.property] ?? "quotePropOther")}</Row>}
        {d.bedrooms !== undefined && <Row label={t("quoteBedrooms")}>{d.bedrooms}</Row>}
        {d.bathrooms !== undefined && <Row label={t("quoteBathrooms")}>{d.bathrooms}</Row>}
        {d.area_sqft !== undefined && <Row label={t("quoteArea")}>{d.area_sqft}</Row>}
        {d.frequency && <Row label={t("quoteFrequency")}>{t(FREQUENCY_KEYS[d.frequency] ?? "quoteFreqUnsure")}</Row>}
        <Row label={t("quoteReceived")}>{when(quote.submitted_at)}</Row>
        <Row label={t("quoteLanguage")}>{LOCALE_NAMES[quote.locale] ?? quote.locale}</Row>
        <Row label={t("quoteIp")}>{quote.ip}</Row>
        {place && <Row label={t("quotePlace")}>{place}</Row>}
      </dl>
      <h3>{t("quoteDescription")}</h3>
      {quote.message ? <p className="quote-body">{quote.message}</p> : <p className="status">{t("quoteNoDescription")}</p>}
      {quote.photos.length > 0 && (
        <>
          <h3>{t("quotePhotos")}</h3>
          <ul className="quote-photos">
            {quote.photos.map((p, i) => {
              const heic = p.content_type === "image/heic"; // browsers cannot draw it: a download
              return (
                <li key={p.id}>
                  {heic ? (
                    <a href={photoUrl(quote.id, p.id)} download aria-label={t("quotePhotoDownload", { n: i + 1 })}>HEIC</a>
                  ) : (
                    <a href={photoUrl(quote.id, p.id)} target="_blank" rel="noreferrer" aria-label={t("quotePhotoOpen", { n: i + 1 })}>
                      <img src={photoUrl(quote.id, p.id)} alt="" loading="lazy" />
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

function Handling({ quote }: { quote: QuoteDetail }) {
  const { t } = useTranslation();
  const { user } = useSession();
  const { navigate } = useRoute();
  const toast = useToast();
  const update = useUpdateQuote(quote.id);
  const remove = useDeleteQuote(quote.id);
  const [note, setNote] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const shownNote = note ?? quote.internal_note ?? "";

  async function saveNote() {
    if (note === null || note === (quote.internal_note ?? "")) return;
    await update.mutateAsync({ internal_note: note });
    setNote(null);
    toast(t("quoteToastNote"));
  }
  async function doDelete() {
    await remove.mutateAsync();
    toast(t("quoteToastDeleted"));
    navigate("/quotes");
  }

  return (
    <section className="section quote-card">
      <div className="field">
        <label htmlFor="quote-status" className="field__label">{t("quoteStatus")}</label>
        <select id="quote-status" className="input" value={quote.status} onChange={(e) => swallow(update.mutateAsync({ status: e.target.value as QuoteStatus }))}>
          {STATUSES.map((s) => <option key={s} value={s}>{t(STATUS_KEYS[s])}</option>)}
        </select>
      </div>
      <TextAreaField label={t("quoteNote")} hint={t("quoteNoteHint")} rows={3} maxLength={5000} value={shownNote} onChange={(e) => setNote(e.target.value)} onBlur={() => swallow(saveNote())} />
      {update.error && <ErrorNotice error={update.error} />}
      <p className="quote-links">
        {quote.task_id && <a href="/tasks" onClick={(e) => { e.preventDefault(); navigate("/tasks"); }}>{t("quoteTaskLink")}</a>}
        {quote.event_id && <a href="/schedule" onClick={(e) => { e.preventDefault(); navigate("/schedule"); }}>{t("quoteAgendaLink")}</a>}
      </p>
      {user.role === "superadmin" && (
        <>
          <Button variant="danger" icon="trash" onClick={() => setConfirming(true)}>{t("quoteDelete")}</Button>
          <Dialog
            open={confirming} title={t("quoteDelete")} onClose={() => setConfirming(false)}
            footer={<><Button variant="ghost" onClick={() => setConfirming(false)}>{t("cancel")}</Button><Button variant="danger" icon="trash" busy={remove.isPending} onClick={() => swallow(doDelete())}>{t("delete")}</Button></>}
          >
            <p>{t("quoteDeleteQuestion")}</p>
            {remove.error && <ErrorNotice error={remove.error} />}
          </Dialog>
        </>
      )}
    </section>
  );
}

/** One quote: the request as sent, the status and note, and the conversation with the customer. */
export function QuoteDetailPage({ id }: { id: number }) {
  const { t } = useTranslation();
  const { navigate } = useRoute();
  const result = useQuote(id);
  const quote = result.data;
  return (
    <>
      <PageHeader
        title={quote ? `${quote.reference} · ${quote.name}` : t("quoteTitle")}
        actions={<Button variant="ghost" icon="chev-left" onClick={() => navigate("/quotes")}>{t("quoteBack")}</Button>}
      />
      {result.isPending ? <Loading /> : result.isError || !quote ? <ErrorNotice error={result.error} onRetry={() => void result.refetch()} /> : (
        <div className="quote-grid">
          <div className="quote-col"><Request quote={quote} /><Handling quote={quote} /></div>
          <div className="quote-col"><Conversation quote={quote} /></div>
        </div>
      )}
    </>
  );
}
