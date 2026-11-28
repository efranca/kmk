import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { ClientPicker } from "../clients/ClientPicker";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { ErrorNotice } from "../ui/Feedback";
import { SelectField, TextAreaField, TextField } from "../ui/Field";
import { useToast } from "../ui/toastContext";
import { useCreateQuote, useEditQuote } from "./hooks";
import { FREQUENCY_KEYS, KIND_KEYS, LOCALE_NAMES, PROPERTY_KEYS } from "./labels";
import type { QuoteDetail, QuoteKind } from "./types";

const KINDS: QuoteKind[] = ["airbnb", "commercial", "post_construction"];
const PROPERTIES = { airbnb: ["house", "apartment", "condo", "other"], commercial: ["office", "clinic", "shop", "restaurant", "industrial", "other"], post_construction: ["house", "apartment", "condo", "office", "shop", "industrial", "other"] } as const;
const FREQUENCIES = { airbnb: ["once", "per_booking", "weekly", "biweekly", "monthly", "unsure"], commercial: ["once", "weekly", "biweekly", "monthly", "post_construction", "unsure"], post_construction: ["once"] } as const;
const LOCALES = ["fr-CA", "en-CA", "pt-BR"] as const;
const PHONE = /^[0-9 +().\-]{7,30}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const text = (v: unknown) => (v === undefined || v === null ? "" : String(v));

/**
 * An administrator writes down a quote that did not come from the form (a phone call, a visit): name, phone and type are enough.
 * With `quote` it is the same form to complete a saved one (no client picker; the customer's own description of a web quote stays as sent).
 */
export function ManualQuoteDialog({ onClose, onCreated, quote }: { onClose: () => void; onCreated?: (id: number) => void; quote?: QuoteDetail }) {
  const { t } = useTranslation();
  const toast = useToast();
  const create = useCreateQuote();
  const edit = useEditQuote(quote?.id ?? 0);
  const d = quote?.details;
  const locked = quote !== undefined && quote.source !== "manual"; // a web quote's description is the record of the request
  const [name, setName] = useState(quote?.name ?? "");
  const [phone, setPhone] = useState(quote?.phone ?? "");
  const [email, setEmail] = useState(quote?.email ?? "");
  const [locale, setLocale] = useState<(typeof LOCALES)[number]>((LOCALES as readonly string[]).includes(quote?.locale ?? "") ? (quote!.locale as (typeof LOCALES)[number]) : "fr-CA");
  const [kind, setKind] = useState<QuoteKind>(quote?.kind ?? "airbnb");
  const [city, setCity] = useState(text(d?.city));
  const [address, setAddress] = useState(text(d?.address));
  const [property, setProperty] = useState(text(d?.property));
  const [frequency, setFrequency] = useState(text(d?.frequency));
  const [bedrooms, setBedrooms] = useState(text(d?.bedrooms));
  const [bathrooms, setBathrooms] = useState(text(d?.bathrooms));
  const [area, setArea] = useState(text(d?.area_sqft));
  const [listing, setListing] = useState(text(d?.listing_url));
  const [message, setMessage] = useState(quote?.message ?? "");
  const [clientId, setClientId] = useState<number | null>(null);
  const pending = create.isPending || edit.isPending;
  const failure = create.error ?? edit.error;
  const [tried, setTried] = useState(false);

  const errors = {
    name: name.trim() ? null : t("quoteManualErrName"),
    phone: PHONE.test(phone.trim()) ? null : t("quoteManualErrPhone"),
    email: email.trim() === "" || EMAIL.test(email.trim()) ? null : t("quoteManualErrEmail"),
    listing: listing.trim() === "" || /^https?:\/\/[^\s/]+\.[^\s/]+/i.test(listing.trim()) ? null : t("propErrListing"),
  };
  const invalid = Object.values(errors).some(Boolean);
  const num = (s: string) => (s.trim() === "" ? undefined : Number(s));

  function pick(next: QuoteKind) {
    setKind(next);
    setProperty("");
    setFrequency(next === "post_construction" ? "once" : "");
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (invalid) return;
    const fields = {
      name: name.trim(), phone: phone.trim(), email: email.trim() || null, locale, kind, city: city.trim(), address: address.trim(),
      property: property || null, frequency: frequency || null,
      ...(kind === "airbnb" ? { bedrooms: num(bedrooms), bathrooms: num(bathrooms), ...(listing.trim() ? { listing_url: listing.trim() } : {}) } : {}),
      ...(num(area) !== undefined ? { area_sqft: num(area) } : {}),
    };
    try {
      if (quote) {
        await edit.mutateAsync({ ...fields, message: locked ? undefined : message.trim() || null } as Parameters<typeof edit.mutateAsync>[0]);
        toast(t("quoteEditDone"));
        onClose();
        return;
      }
      const made = await create.mutateAsync({ ...fields, message: message.trim() || null, client_id: clientId });
      toast(t("quoteManualCreated"));
      onClose();
      onCreated?.(made.id);
    } catch {
      // shown from the mutation's error
    }
  }

  const shown = (key: keyof typeof errors) => (tried ? errors[key] : null);
  const footer = (
    <>
      <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
      <Button type="submit" form="quote-manual-form" variant="primary" busy={pending}>{t("save")}</Button>
    </>
  );

  return (
    <Dialog open title={quote ? t("quoteEditTitle") : t("quoteManualTitle")} onClose={onClose} footer={footer}>
      <form id="quote-manual-form" className="doc-form" onSubmit={(e) => void submit(e)} noValidate>
        {!quote && <p className="status">{t("quoteManualHint")}</p>}
        <TextField label={t("clientFieldName")} value={name} maxLength={100} autoFocus error={shown("name")} onChange={(e) => setName(e.target.value)} />
        <div className="client-f2">
          <TextField label={t("clientFieldPhone")} type="tel" value={phone} maxLength={30} error={shown("phone")} onChange={(e) => setPhone(e.target.value)} />
          <TextField label={`${t("clientFieldEmail")} (${t("optional")})`} type="email" value={email} maxLength={254} error={shown("email")} hint={t("quoteManualNoEmail")} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="client-f2">
          <SelectField label={t("quoteType")} value={kind} onChange={(e) => pick(e.target.value as QuoteKind)}>
            {KINDS.map((k) => <option key={k} value={k}>{t(KIND_KEYS[k])}</option>)}
          </SelectField>
          <SelectField label={t("quoteLanguage")} value={locale} onChange={(e) => setLocale(e.target.value as (typeof LOCALES)[number])}>
            {LOCALES.map((l) => <option key={l} value={l}>{LOCALE_NAMES[l]}</option>)}
          </SelectField>
        </div>
        <div className="client-f2">
          <TextField label={t("quoteCity")} value={city} maxLength={60} onChange={(e) => setCity(e.target.value)} />
          <TextField label={t("clientFieldAddress")} value={address} maxLength={200} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <div className="client-f2">
          <SelectField label={t("quoteProperty")} value={property} onChange={(e) => setProperty(e.target.value)}>
            <option value="" />
            {PROPERTIES[kind].map((p) => <option key={p} value={p}>{t(PROPERTY_KEYS[p]!)}</option>)}
          </SelectField>
          <SelectField label={t("quoteFrequency")} value={frequency} onChange={(e) => setFrequency(e.target.value)}>
            <option value="" />
            {FREQUENCIES[kind].map((f) => <option key={f} value={f}>{t(FREQUENCY_KEYS[f]!)}</option>)}
          </SelectField>
        </div>
        {kind === "airbnb" && (
          <div className="client-f2">
            <TextField label={t("quoteBedrooms")} type="number" inputMode="numeric" min={0} max={20} value={bedrooms} onChange={(e) => setBedrooms(e.target.value)} />
            <TextField label={t("quoteBathrooms")} type="number" inputMode="decimal" min={0} max={20} step={0.5} value={bathrooms} onChange={(e) => setBathrooms(e.target.value)} />
          </div>
        )}
        <TextField label={t("quoteArea")} type="number" inputMode="numeric" min={1} max={1000000} value={area} onChange={(e) => setArea(e.target.value)} />
        {kind === "airbnb" && <TextField label={t("propFieldListing")} type="url" inputMode="url" value={listing} maxLength={300} error={shown("listing")} onChange={(e) => setListing(e.target.value)} />}
        {locked ? (
          <div className="field">
            <span className="field__label">{t("quoteManualNotes")}</span>
            <p className="quote-body">{message || t("quoteNoDescription")}</p>
          </div>
        ) : (
          <TextAreaField label={t("quoteManualNotes")} rows={5} value={message} maxLength={12000} onChange={(e) => setMessage(e.target.value)} />
        )}
        {!quote && <ClientPicker value={clientId} onChange={setClientId} />}
      </form>
      {failure && <ErrorNotice error={failure} />}
    </Dialog>
  );
}
