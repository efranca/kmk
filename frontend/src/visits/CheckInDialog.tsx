import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import type { ListedPerson, Visit } from "./api";
import { VisitErrorNotice } from "./CorrectionDialog";
import { useCheckIn } from "./hooks";

/** Who is here: the listed people not checked in yet, the person themselves pre-selected. The server records the time. */
export function CheckInDialog({ visit, meId, onClose }: { visit: Visit; meId: number; onClose: () => void }) {
  const { t } = useTranslation();
  const formId = useId();
  const mutation = useCheckIn();
  const active = new Set(visit.people.map((p) => p.user_id));
  const candidates: ListedPerson[] = visit.listed.filter((p) => !active.has(p.user_id));
  const meHere = active.has(meId);
  const [picked, setPicked] = useState<Set<number>>(() => new Set(candidates.some((p) => p.user_id === meId) ? [meId] : []));
  const needsMe = !meHere && !picked.has(meId); // someone not checked in yet must include themselves
  const ready = picked.size > 0 && !needsMe;

  function toggle(id: number) {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready || mutation.isPending) return;
    const people = candidates.filter((p) => picked.has(p.user_id)).map((p) => p.user_id);
    try {
      await mutation.mutateAsync({ eventId: visit.event_id, occurrenceDate: visit.occurrence_date, people });
      onClose();
    } catch {
      // shown below from the mutation's error
    }
  }

  const footer = (
    <>
      <span className="dialog__spacer" />
      <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
      <Button type="submit" form={formId} variant="primary" icon="check" busy={mutation.isPending} disabled={!ready}>{t("visCheckIn")}</Button>
    </>
  );
  return (
    <Dialog open title={t("visCheckIn")} onClose={onClose} footer={footer}>
      <form id={formId} className="doc-form" onSubmit={(e) => void submit(e)} noValidate>
        <fieldset className="visit-choices">
          <legend className="field__label">{t("visWhoIsHere")}</legend>
          {candidates.map((p) => (
            <label key={p.user_id} className="visit-choice">
              <input type="checkbox" checked={picked.has(p.user_id)} onChange={() => toggle(p.user_id)} />
              <span>{p.user_id === meId ? t("visMe", { name: p.name }) : p.name}</span>
            </label>
          ))}
        </fieldset>
        {needsMe && <p className="visit-hint" role="status">{t("visCheckInNeedSelf")}</p>}
      </form>
      {mutation.error && <VisitErrorNotice error={mutation.error} />}
    </Dialog>
  );
}
