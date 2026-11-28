import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { addDays } from "../schedule/scheduleDates";
import { displayName } from "../person";
import { useSession } from "../session";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import type { Visit } from "./api";
import { CheckInDialog } from "./CheckInDialog";
import { CorrectionDialog, ReasonDialog, VisitErrorNotice } from "./CorrectionDialog";
import { useCheckOut } from "./hooks";
import { canCorrect, clock, codeOf, companyDay, companyToday, formatDay, KIND_KEYS, STATE_KEYS } from "./labels";
import { PhotoRooms, type PhotoMode } from "./PhotoRooms";

/** One visit: its state, who is here (and who marked them), Check-in / Check-out, the photos by room, and Correct. */
export function VisitCard({ visit, showDate = false }: { visit: Visit; showDate?: boolean }) {
  const { t, i18n } = useTranslation();
  const { user } = useSession();
  const titleId = useId();
  const photosHeading = useRef<HTMLHeadingElement>(null);
  const checkOut = useCheckOut();
  const [dialog, setDialog] = useState<"checkin" | "nophotos" | "correct" | null>(null);
  const [reasonPrompt, setReasonPrompt] = useState<{ title: string; run: (reason: string) => Promise<unknown> } | null>(null);

  const isAdmin = user.role !== "user";
  const today = companyToday();
  const onItsDay = visit.date === today;
  const amListed = visit.listed.some((p) => p.user_id === user.id);
  const amHere = visit.people.some((p) => p.user_id === user.id);
  const absent = visit.listed.filter((p) => !visit.people.some((h) => h.user_id === p.user_id));
  const mayCorrect = canCorrect(visit, isAdmin, today);
  const showCheckIn = visit.state !== "closed" && onItsDay && amListed && absent.length > 0 && (amHere || absent.some((p) => p.user_id === user.id));
  const showCheckOut = visit.state === "in_progress" && onItsDay && amHere;
  const photoMode: PhotoMode = visit.id === null ? "view" : visit.state === "in_progress" && onItsDay && amHere ? "plain" : mayCorrect ? "correct" : "view";

  async function close(confirmNoPhotos: boolean) {
    if (checkOut.isPending) return;
    try {
      await checkOut.mutateAsync({ eventId: visit.event_id, occurrenceDate: visit.occurrence_date, confirmNoPhotos });
      setDialog(null);
    } catch (err) {
      if (codeOf(err) === "no_photos") {
        checkOut.reset();
        setDialog("nophotos");
      }
      // any other refusal stays on screen (in the warning when it is open) with the server's words
    }
  }

  function takePhotos() {
    setDialog(null);
    requestAnimationFrame(() => photosHeading.current?.focus());
  }

  const place = [visit.client_name, visit.property_name].filter(Boolean).join(" · ");
  return (
    <article className="visit-card" aria-labelledby={titleId}>
      <header className="visit-card__head">
        <div className="visit-card__title">
          <h2 id={titleId}>{visit.title ?? visit.property_name}</h2>
          {place && <p className="visit-card__place">{place}</p>}
          {showDate && <p className="visit-card__place">{formatDay(visit.date, i18n.language)}</p>}
        </div>
        <span className="visit-card__badges">
          <span className={`visit-state visit-state--${visit.state}`}>{t(STATE_KEYS[visit.state])}</span>
          {visit.corrected && <span className="visit-state visit-state--corrected">{t("visCorrected")}</span>}
        </span>
      </header>

      <section className="visit-people" aria-label={t("visWhoIsHere")}>
        {visit.people.length === 0 ? (
          <p className="visit-hint">{t("visNobodyYet")}</p>
        ) : (
          <ul>
            {visit.people.map((p) => (
              <li key={`${p.user_id}-${p.checked_in_at}`}>
                {p.self ? t("visSelf", { name: p.name, time: clock(p.checked_in_at) }) : t("visMarkedBy", { name: p.name, by: p.checked_in_by_name ?? "?", time: clock(p.checked_in_at) })}
              </li>
            ))}
          </ul>
        )}
        {visit.state === "closed" && visit.closed_at && <p className="visit-hint">{t("visClosedBy", { name: visit.closed_by_name ?? "?", time: clock(visit.closed_at) })}</p>}
        {visit.closed_without_photos && isAdmin && <p className="visit-flag">{t("visClosedWithoutPhotos")}</p>}
      </section>

      {(showCheckIn || showCheckOut) && (
        <div className="visit-actions">
          {showCheckIn && <Button variant="primary" icon="check" onClick={() => setDialog("checkin")}>{t("visCheckIn")}</Button>}
          {showCheckOut && <Button variant={showCheckIn ? "secondary" : "primary"} icon="logout" busy={checkOut.isPending} onClick={() => void close(false)}>{t("visCheckOut")}</Button>}
        </div>
      )}
      {checkOut.error && dialog !== "nophotos" && <VisitErrorNotice error={checkOut.error} />}

      {visit.id !== null && <PhotoRooms ref={photosHeading} visit={visit} mode={photoMode} isAdmin={isAdmin} myName={displayName(user)} askReason={(title, run) => setReasonPrompt({ title, run })} />}

      {visit.corrections.length > 0 && (
        <section className="visit-corrections" aria-label={t("visCorrections")}>
          <h3>{t("visCorrections")}</h3>
          <ul>
            {visit.corrections.map((c, i) => (
              <li key={`${c.created_at}-${i}`}>
                <b>{t(KIND_KEYS[c.kind] ?? "visCorrect")}</b> — {t("visCorrectionLine", { name: c.actor_name ?? "?", day: formatDay(companyDay(c.created_at), i18n.language), reason: c.reason })}
              </li>
            ))}
          </ul>
        </section>
      )}

      {mayCorrect && (
        <div className="visit-actions visit-actions--correct">
          <Button icon="pencil" onClick={() => setDialog("correct")}>{t("visCorrect")}</Button>
          {!isAdmin && <p className="visit-hint">{t("visCorrectUntil", { day: formatDay(addDays(visit.date, 1), i18n.language) })}</p>}
        </div>
      )}

      {dialog === "checkin" && <CheckInDialog visit={visit} meId={user.id} onClose={() => setDialog(null)} />}
      {dialog === "correct" && <CorrectionDialog visit={visit} isAdmin={isAdmin} meId={user.id} onClose={() => setDialog(null)} />}
      {dialog === "nophotos" && (
        <Dialog
          open
          title={t("visNoPhotosTitle")}
          onClose={() => setDialog(null)}
          footer={
            <>
              <span className="dialog__spacer" />
              <Button variant="ghost" busy={checkOut.isPending} onClick={() => void close(true)}>{t("visCloseWithoutPhotos")}</Button>
              <Button variant="primary" icon="camera" autoFocus disabled={checkOut.isPending} onClick={takePhotos}>{t("visTakePhotos")}</Button>
            </>
          }
        >
          <p>{t("visNoPhotosBody")}</p>
          {checkOut.error && <VisitErrorNotice error={checkOut.error} />}
        </Dialog>
      )}
      {reasonPrompt && <ReasonDialog title={reasonPrompt.title} onSubmit={reasonPrompt.run} onClose={() => setReasonPrompt(null)} />}
    </article>
  );
}
