import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { SelectField, TextAreaField } from "../ui/Field";
import type { CorrectionInput, Visit } from "./api";
import { useCorrection } from "./hooks";
import { codeOf, KIND_KEYS, visitError } from "./labels";

export const REASON_MAX = 200;

/** The refusal of a request, with the rooms when the answer is `rooms_missing`. */
export function VisitErrorNotice({ error }: { error: unknown }) {
  const { t } = useTranslation();
  const rooms = codeOf(error) === "rooms_missing" && typeof error === "object" && error !== null && "rooms" in error ? (error as { rooms: string[] }).rooms : [];
  return (
    <div className="notice notice--error" role="alert">
      <p>{visitError(error, t)}</p>
      {rooms.length > 0 && (
        <ul className="visit-missing">
          {rooms.map((room) => <li key={room}>{room}</li>)}
        </ul>
      )}
    </div>
  );
}

/**
 * Asks why a change is made after the fact (a photo added or removed once the visit is closed or its day is over), then
 * runs it with that reason. Stays open with the server's answer when it is refused.
 */
export function ReasonDialog({ title, onSubmit, onClose }: { title: string; onSubmit: (reason: string) => Promise<unknown>; onClose: () => void }) {
  const { t } = useTranslation();
  const formId = useId();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !reason.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(reason.trim());
      onClose();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  const footer = (
    <>
      <span className="dialog__spacer" />
      <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
      <Button type="submit" form={formId} variant="primary" busy={busy} disabled={!reason.trim()}>{t("visCorrect")}</Button>
    </>
  );
  return (
    <Dialog open title={title} onClose={onClose} footer={footer}>
      <form id={formId} className="doc-form" onSubmit={(e) => void submit(e)} noValidate>
        <p className="visit-hint">{t("visCorrectionWhy")}</p>
        <TextAreaField label={t("visCorrectionReason")} value={reason} maxLength={REASON_MAX} autoFocus required onChange={(e) => setReason(e.target.value)} />
      </form>
      {error !== null && <VisitErrorNotice error={error} />}
    </Dialog>
  );
}

type Kind = CorrectionInput["kind"];

/** What can be corrected on this visit, and for whom (the server re-checks everything). */
function options(visit: Visit, isAdmin: boolean, meId: number) {
  const active = new Set(visit.people.map((p) => p.user_id));
  const absent = visit.listed.filter((p) => !active.has(p.user_id));
  const kinds: Kind[] = [];
  if (visit.state === "in_progress") kinds.push("close");
  if (visit.people.length > 0) kinds.push("withdraw");
  // Staff on a visit never started: only themselves (a forgotten check-in).
  const addable = visit.state === "not_started" && !isAdmin ? absent.filter((p) => p.user_id === meId) : absent;
  if (addable.length > 0) kinds.push("add_person");
  if (visit.state === "closed" && isAdmin) kinds.push("reopen");
  const withdrawable = visit.people.filter((p): p is typeof p & { user_id: number } => p.user_id !== null).map((p) => ({ user_id: p.user_id, name: p.name }));
  return { kinds, people: { withdraw: withdrawable, add_person: addable } as Record<"withdraw" | "add_person", { user_id: number; name: string }[]> };
}

/** The Correct dialog: close a visit left open, withdraw a check-in, add a late one, reopen (admins); the reason is required. */
export function CorrectionDialog({ visit, isAdmin, meId, onClose }: { visit: Visit; isAdmin: boolean; meId: number; onClose: () => void }) {
  const { t } = useTranslation();
  const formId = useId();
  const mutation = useCorrection();
  const { kinds, people } = options(visit, isAdmin, meId);
  const [kind, setKind] = useState<Kind | null>(kinds.length === 1 ? kinds[0] : null);
  const [person, setPerson] = useState("");
  const [reason, setReason] = useState("");
  const about = kind === "withdraw" || kind === "add_person" ? people[kind] : null;
  const userId = about ? (about.length === 1 ? about[0].user_id : Number(person) || null) : null;
  const ready = kind !== null && reason.trim() !== "" && (about === null || userId !== null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready || mutation.isPending || kind === null) return;
    const input: CorrectionInput = { kind, reason: reason.trim(), ...(userId !== null ? { user_id: userId } : {}) };
    try {
      await mutation.mutateAsync({ eventId: visit.event_id, occurrenceDate: visit.occurrence_date, input });
      onClose();
    } catch {
      // shown below from the mutation's error
    }
  }

  const footer = (
    <>
      <span className="dialog__spacer" />
      <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
      <Button type="submit" form={formId} variant="primary" busy={mutation.isPending} disabled={!ready}>{t("visCorrect")}</Button>
    </>
  );
  return (
    <Dialog open title={t("visCorrect")} onClose={onClose} footer={footer}>
      <form id={formId} className="doc-form visit-correct" onSubmit={(e) => void submit(e)} noValidate>
        <fieldset className="visit-choices">
          <legend className="field__label">{t("visCorrectionWhat")}</legend>
          {kinds.map((k) => (
            <label key={k} className="visit-choice">
              <input type="radio" name={`${formId}-kind`} value={k} checked={kind === k} onChange={() => { setKind(k); setPerson(""); mutation.reset(); }} />
              <span>{t(KIND_KEYS[k])}</span>
            </label>
          ))}
        </fieldset>
        {about && about.length > 1 && (
          <SelectField label={t("visPerson")} value={person} onChange={(e) => setPerson(e.target.value)}>
            <option value="">{t("visPickPerson")}</option>
            {about.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
          </SelectField>
        )}
        {about && about.length === 1 && <p className="visit-hint">{t("visPersonIs", { name: about[0].name })}</p>}
        <TextAreaField label={t("visCorrectionReason")} value={reason} maxLength={REASON_MAX} required onChange={(e) => setReason(e.target.value)} />
      </form>
      {mutation.error && <VisitErrorNotice error={mutation.error} />}
    </Dialog>
  );
}
