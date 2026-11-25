import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import { PublicApiError, publicConfig, startQuote, submitQuote, uploadPhoto, type QuoteInput } from "./api";
import { MAX_PHOTOS, PhotoPicker, photoProblem } from "./PhotoPicker";
import { initialLocale, LOCALES, translate, type PublicLocale } from "./strings";
import { countWords } from "./words";

const MAX_WORDS = 2000;
const PHONE = /^[0-9 +().-]{7,30}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PROPERTIES = { airbnb: ["house", "apartment", "condo", "other"], commercial: ["office", "clinic", "shop", "restaurant", "industrial", "other"] } as const;
const FREQUENCIES = {
  airbnb: ["once", "per_booking", "weekly", "biweekly", "monthly", "unsure"],
  commercial: ["once", "weekly", "biweekly", "monthly", "post_construction", "unsure"],
} as const;
const LANGUAGE_NAMES: Record<PublicLocale, string> = { "fr-CA": "Français", "en-CA": "English", "pt-BR": "Português" };
const SITE: Record<PublicLocale, string> = { "fr-CA": "https://kmk-entretien.ca/fr/", "en-CA": "https://kmk-entretien.ca/en/", "pt-BR": "https://kmk-entretien.ca/fr/" };

type Kind = "airbnb" | "commercial";
type Values = { name: string; email: string; phone: string; city: string; address: string; property: string; frequency: string; bedrooms: string; bathrooms: string; area: string; message: string };
type Errors = Partial<Record<keyof Values, string>>;
const EMPTY: Values = { name: "", email: "", phone: "", city: "", address: "", property: "", frequency: "", bedrooms: "", bathrooms: "", area: "", message: "" };
type Draft = { id: number; token: string; uploaded: number };

function Field({ id, label, required, error, hint, children }: { id: string; label: string; required?: boolean; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}{required && <> <span className="req" aria-hidden="true">*</span></>}</label>
      {children}
      {hint && <p className="pq-hint">{hint}</p>}
      {error && <p className="pq-err" role="alert">{error}</p>}
    </div>
  );
}

export function QuoteForm() {
  const [locale, setLocale] = useState<PublicLocale>(() => initialLocale(window.location.search, navigator.language));
  const t = (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars);
  const [kind, setKind] = useState<Kind | null>(null);
  const [v, setV] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [files, setFiles] = useState<File[]>([]);
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const draft = useRef<Draft | null>(null);
  const trap = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = `${translate(locale, "pqPageTitle")} · KMK Entretien Ménager`;
  }, [locale]);
  useEffect(() => {
    publicConfig().then((c) => setPhone(c.phone)).catch(() => undefined);
  }, []);

  // Any change after a failed try starts a new request: the draft on the server holds the first values, and photos
  // already sent are counted by position.
  const touch = () => { draft.current = null; };
  const set = (key: keyof Values) => (e: { target: { value: string } }) => { touch(); setV((old) => ({ ...old, [key]: e.target.value })); };
  const words = countWords(v.message);
  const over = words > MAX_WORDS;

  function chooseKind(next: Kind) {
    touch();
    setKind(next);
    setV((old) => ({ ...old, property: "", frequency: "" }));
    setErrors({});
  }

  function addPhotos(picked: File[]) {
    touch();
    let next = files;
    let note: string | null = null;
    for (const file of picked) {
      const problem = photoProblem(file, next.length);
      if (problem) note = t(problem.kind === "count" ? "pqErrPhotoCount" : problem.kind === "size" ? "pqErrPhotoSize" : "pqErrPhotoType", { name: problem.name });
      else next = [...next, file];
    }
    setFiles(next);
    setPhotoNote(note);
  }

  function validate(): Errors {
    const e: Errors = {};
    const required = (key: keyof Values) => { if (!v[key].trim()) e[key] = t("pqErrRequired"); };
    (["name", "email", "phone", "city", "address", "property", "frequency"] as const).forEach(required);
    if (!e.email && !EMAIL.test(v.email.trim())) e.email = t("pqErrEmail");
    if (!e.phone && !PHONE.test(v.phone.trim())) e.phone = t("pqErrPhone");
    if (kind === "airbnb") {
      (["bedrooms", "bathrooms"] as const).forEach(required);
      // The same ranges as the server, so a refusal never comes back as a "try again".
      if (!e.bedrooms && !(/^\d{1,2}$/.test(v.bedrooms.trim()) && Number(v.bedrooms) <= 20)) e.bedrooms = t("pqErrBedrooms");
      const baths = Number(v.bathrooms);
      if (!e.bathrooms && !(v.bathrooms.trim() !== "" && baths >= 0 && baths <= 20 && (baths * 2) % 1 === 0)) e.bathrooms = t("pqErrBathrooms");
    }
    if (v.area.trim() !== "" && !(/^\d+$/.test(v.area.trim()) && Number(v.area) >= 1 && Number(v.area) <= 1_000_000)) e.area = t("pqErrArea");
    if (kind === "commercial" && !v.message.trim()) e.message = t("pqErrMessage");
    if (over) e.message = t("pqErrTooLong");
    return e;
  }

  function payload(): QuoteInput {
    const num = (s: string) => (s.trim() === "" ? undefined : Number(s));
    return {
      name: v.name.trim(), email: v.email.trim(), phone: v.phone.trim(), locale, kind: kind!, city: v.city.trim(), address: v.address.trim(), property: v.property, frequency: v.frequency,
      ...(kind === "airbnb" ? { bedrooms: num(v.bedrooms), bathrooms: num(v.bathrooms) } : {}),
      ...(num(v.area) !== undefined ? { area_sqft: num(v.area) } : {}),
      message: v.message.trim() || null, website: trap.current?.value ?? "",
    };
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!kind || busy) return;
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setFailure(t("pqErrFields"));
      return;
    }
    setFailure(null);
    setBusy(t("pqSending"));
    try {
      // A retry after a network failure resumes where it stopped: the draft and the photos already sent are kept.
      if (!draft.current) {
        const started = await startQuote(payload());
        draft.current = { id: started.id, token: started.token, uploaded: 0 };
      }
      const d = draft.current;
      while (d.uploaded < files.length) {
        setBusy(t("pqSendingPhoto", { n: d.uploaded + 1, total: files.length }));
        await uploadPhoto(d.id, d.token, files[d.uploaded]);
        d.uploaded += 1;
      }
      setReference(await submitQuote(d.id, d.token));
      draft.current = null;
    } catch (error) {
      const code = error instanceof PublicApiError ? error.code : "network";
      const d = draft.current;
      if (code === "rate_limited") setFailure(t("pqRateLimited", { call: phone ? t("pqRateLimitedCall", { phone }) : "" }));
      else if (code === "too_long") setFailure(t("pqErrTooLong"));
      else if (code === "invalid") setFailure(t("pqErrFields"));
      else if (code === "busy") setFailure(t("pqErrBusy"));
      else if (d && ["unsupported_type", "file_too_large", "too_many_photos"].includes(code)) {
        // The server refused this photo: say which one and drop it. The photos already sent stay (it is the next in line).
        const refused = files[d.uploaded];
        setFiles((old) => old.filter((_, n) => n !== d.uploaded));
        setFailure(t("pqErrPhotoRefused", { name: refused?.name ?? "" }));
      } else if (code === "not_found") { draft.current = null; setFailure(t("pqErrNetwork")); } // the draft expired: start again next time
      else setFailure(t("pqErrNetwork"));
    } finally {
      setBusy(null);
    }
  }

  function again() {
    setReference(null); setKind(null); setV(EMPTY); setFiles([]); setErrors({}); setFailure(null); setPhotoNote(null);
  }

  const sending = busy !== null;
  return (
    <div className="pq">
      <header className="pq-hdr">
        <div className="wrap pq-hdr-row">
          <a className="brand" href={SITE[locale]}><img className="brand-logo" src="/logo-horizontal.png" alt="KMK Entretien Ménager" /></a>
          <div className="pq-lang" role="group" aria-label={t("pqLanguage")}>
            {LOCALES.map((code) => (
              <button key={code} type="button" className="pq-lang-btn" aria-pressed={code === locale} onClick={() => setLocale(code)}>{LANGUAGE_NAMES[code]}</button>
            ))}
          </div>
        </div>
      </header>

      <main className="wrap pq-main">
        <a className="pq-back" href={SITE[locale]}>← {t("pqHome")}</a>
        <span className="eyebrow">{t("pqPageTitle")}</span>
        <h1>{t("pqTitle")}</h1>
        <p className="pq-lead">{t("pqIntro")}</p>

        {reference ? (
          <section className="form pq-done" aria-live="polite">
            <h2>{t("pqDoneTitle")}</h2>
            <p>{t("pqDoneBody")}</p>
            <p>{t("pqDoneRef")}</p>
            <p className="pq-ref">{reference}</p>
            <button type="button" className="btn btn-ghost" onClick={again}>{t("pqAnother")}</button>
          </section>
        ) : (
          <form className="form" onSubmit={submit} noValidate>
            <fieldset className="pq-fieldset">
              <legend>{t("pqKind")}</legend>
              <div className="pq-kinds" role="radiogroup" aria-label={t("pqKind")}>
                {(["airbnb", "commercial"] as const).map((k) => (
                  <label key={k} className={`pq-kind${kind === k ? " on" : ""}`}>
                    <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => chooseKind(k)} disabled={sending} />
                    <b>{t(k === "airbnb" ? "pqKindAirbnb" : "pqKindCommercial")}</b>
                    <small>{t(k === "airbnb" ? "pqKindAirbnbHint" : "pqKindCommercialHint")}</small>
                  </label>
                ))}
              </div>
            </fieldset>

            <h2 className="pq-h2">{t("pqContact")}</h2>
            <div className="f2">
              <Field id="pq-name" label={t("pqName")} required error={errors.name}><input id="pq-name" autoComplete="name" value={v.name} onChange={set("name")} disabled={sending} /></Field>
              <Field id="pq-email" label={t("pqEmail")} required error={errors.email}><input id="pq-email" type="email" autoComplete="email" value={v.email} onChange={set("email")} disabled={sending} /></Field>
            </div>
            <Field id="pq-phone" label={t("pqPhone")} required error={errors.phone}><input id="pq-phone" type="tel" autoComplete="tel" placeholder="(418) 000-0000" value={v.phone} onChange={set("phone")} disabled={sending} /></Field>

            {kind && (
              <>
                <h2 className="pq-h2">{t("pqSpace")}</h2>
                <div className="f2">
                  <Field id="pq-city" label={t("pqCity")} required error={errors.city}><input id="pq-city" autoComplete="address-level2" maxLength={60} value={v.city} onChange={set("city")} disabled={sending} /></Field>
                  <Field id="pq-address" label={t("pqAddress")} required error={errors.address}><input id="pq-address" autoComplete="street-address" maxLength={200} value={v.address} onChange={set("address")} disabled={sending} /></Field>
                </div>
                <div className="f2">
                  <Field id="pq-property" label={t("pqProperty")} required error={errors.property}>
                    <select id="pq-property" value={v.property} onChange={set("property")} disabled={sending}>
                      <option value="" />
                      {PROPERTIES[kind].map((p) => <option key={p} value={p}>{t(`pqProp_${p}`)}</option>)}
                    </select>
                  </Field>
                  <Field id="pq-frequency" label={t("pqFrequency")} required error={errors.frequency}>
                    <select id="pq-frequency" value={v.frequency} onChange={set("frequency")} disabled={sending}>
                      <option value="" />
                      {FREQUENCIES[kind].map((f) => <option key={f} value={f}>{t(`pqFreq_${f}`)}</option>)}
                    </select>
                  </Field>
                </div>
                {kind === "airbnb" && (
                  <div className="f2">
                    <Field id="pq-bedrooms" label={t("pqBedrooms")} required error={errors.bedrooms}><input id="pq-bedrooms" type="number" inputMode="numeric" min={0} max={20} step={1} value={v.bedrooms} onChange={set("bedrooms")} disabled={sending} /></Field>
                    <Field id="pq-bathrooms" label={t("pqBathrooms")} required error={errors.bathrooms}><input id="pq-bathrooms" type="number" inputMode="decimal" min={0} max={20} step={0.5} value={v.bathrooms} onChange={set("bathrooms")} disabled={sending} /></Field>
                  </div>
                )}
                <Field id="pq-area" label={t("pqArea")} error={errors.area}><input id="pq-area" type="number" inputMode="numeric" min={1} max={1000000} value={v.area} onChange={set("area")} disabled={sending} /></Field>
              </>
            )}

            <Field
              id="pq-message" label={t("pqMessage")} required={kind === "commercial"} error={errors.message}
              hint={t(kind === "commercial" ? "pqMessageHintCommercial" : "pqMessageHintAirbnb")}
            >
              <textarea id="pq-message" rows={6} value={v.message} onChange={set("message")} disabled={sending} />
              <p className={`pq-count${over ? " over" : ""}`}>{t("pqWords", { n: words, max: MAX_WORDS })}</p>
            </Field>

            <div className="field">
              <span className="pq-label">{t("pqPhotos")}</span>
              <p className="pq-hint">{t("pqPhotosHint")}</p>
              <PhotoPicker
                files={files} onAdd={addPhotos} onRemove={(i) => { touch(); setFiles((old) => old.filter((_, n) => n !== i)); }}
                label={t("pqAddPhotos")} removeLabel={(name) => t("pqRemovePhoto", { name })} disabled={sending}
              />
              {photoNote && <p className="pq-err" role="alert">{photoNote}</p>}
            </div>

            {/* honeypot: bots fill it, people never see it */}
            <input ref={trap} className="hp" type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" />

            {failure && <p className="form-msg bad" role="alert">{failure}</p>}
            <button className="btn btn-primary" type="submit" disabled={over || sending} aria-busy={sending || undefined} style={{ width: "100%" }}>
              {busy ?? t("pqSend")}
            </button>
            <p className="form-note">{t("pqNote")}</p>
            <p className="form-note">{t("pqPrivacy")}</p>
          </form>
        )}
      </main>

      <footer className="ftr">
        <div className="wrap pq-ftr">
          <img className="brand-logo" src="/logo-horizontal.png" alt="KMK Entretien Ménager" />
          <p>{t("pqFooterArea")}</p>
          {phone && <p>{t("pqFooterCall")} : <a href={`tel:${phone.replace(/[^\d+]/g, "")}`}>{phone}</a></p>}
        </div>
      </footer>
    </div>
  );
}
