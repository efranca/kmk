import { forwardRef, useId, useState, type ChangeEvent, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { Button, IconButton } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { TextAreaField, TextField } from "../ui/Field";
import { Icon } from "../ui/Icon";
import type { PhotoTarget, Visit, VisitPhoto } from "./api";
import { REASON_MAX, VisitErrorNotice } from "./CorrectionDialog";
import { useRemovePhoto, useSkipRoom, useUploadPhoto } from "./hooks";
import { codeOf, visitError } from "./labels";
import { preparePhoto } from "./preparePhoto";

export const ROOM_NAME_MAX = 60;

/** "plain": open on its day and the person is checked in; "correct": each change needs a reason; "view": look only. */
export type PhotoMode = "plain" | "correct" | "view";
export type AskReason = (title: string, run: (reason: string) => Promise<unknown>) => void;

/** The server says this change is a correction (closed, or past its day): ask for a reason and send it again. */
const needsReason = (error: unknown) => ["correction_required", "already_closed"].includes(codeOf(error));

/** The two ways to add a photo: the camera (on a phone), or a picture already taken. Labels, so a tap opens the picker. */
function AddPhoto({ disabled, onFile }: { disabled: boolean; onFile: (e: ChangeEvent<HTMLInputElement>) => void }) {
  const { t } = useTranslation();
  return (
    <div className="visit-add">
      <label className={disabled ? "btn btn--primary visit-add__button is-disabled" : "btn btn--primary visit-add__button"}>
        <Icon name="camera" />
        <span>{t("visAddPhoto")}</span>
        <input className="visually-hidden" type="file" accept="image/*" capture="environment" disabled={disabled} onChange={onFile} />
      </label>
      <label className={disabled ? "btn btn--secondary visit-add__button is-disabled" : "btn btn--secondary visit-add__button"}>
        <Icon name="image" />
        <span>{t("visFromGallery")}</span>
        <input className="visually-hidden" type="file" accept="image/*" disabled={disabled} onChange={onFile} />
      </label>
    </div>
  );
}

function Thumb({ photo, canRemove, busy, onOpen, onRemove }: { photo: VisitPhoto; canRemove: boolean; busy: boolean; onOpen: () => void; onRemove: () => void }) {
  const { t } = useTranslation();
  return (
    <li className="visit-thumb">
      <button type="button" className="visit-thumb__open" onClick={onOpen}>
        <img src={photo.url} alt={t("visPhotoOf", { room: photo.room_name })} loading="lazy" />
      </button>
      {canRemove && <IconButton icon="trash" label={t("visRemovePhoto")} className="visit-thumb__remove" disabled={busy} onClick={onRemove} />}
    </li>
  );
}

/** The photos of a visit grouped by room (the property's list, then Other), with Add photo and, when photos are required, Skip room. */
export const PhotoRooms = forwardRef<HTMLHeadingElement, { visit: Visit; mode: PhotoMode; isAdmin: boolean; myName: string; askReason: AskReason }>(function PhotoRooms(
  { visit, mode, isAdmin, myName, askReason },
  headingRef,
) {
  const { t } = useTranslation();
  const headingId = useId();
  const upload = useUploadPhoto();
  const remove = useRemovePhoto();
  const [preparing, setPreparing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [otherName, setOtherName] = useState("");
  const [viewing, setViewing] = useState<VisitPhoto | null>(null);
  const [confirming, setConfirming] = useState<VisitPhoto | null>(null);
  const [skipping, setSkipping] = useState<{ id: number; name: string } | null>(null);
  const ref = { eventId: visit.event_id, occurrenceDate: visit.occurrence_date };
  const writable = mode !== "view";
  const busy = preparing || upload.isPending || remove.isPending;
  const roomIds = new Set(visit.rooms.map((r) => r.id));
  const others = visit.photos.filter((p) => p.room_id === null || !roomIds.has(p.room_id));
  const canRemove = (p: VisitPhoto) => writable && (p.uploaded_by_name === myName || (isAdmin && mode === "correct"));

  async function onFile(target: PhotoTarget, e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // the same picture can be picked again after a failure
    if (!file || busy) return;
    setError(null);
    setStatus(null);
    setPreparing(true);
    let photo: Blob;
    try {
      photo = await preparePhoto(file);
    } catch (err) {
      setError(err);
      setPreparing(false);
      return;
    }
    setPreparing(false);
    setProgress(0);
    const send = async (reason?: string) => {
      await upload.mutateAsync({ ...ref, photo, target, reason, onProgress: setProgress });
      setStatus(t("visPhotoAdded"));
    };
    if (mode === "correct") return askReason(t("visAddPhoto"), send);
    try {
      await send();
    } catch (err) {
      if (needsReason(err)) askReason(t("visAddPhoto"), send);
      else setError(err);
    }
  }

  async function removeNow(photo: VisitPhoto) {
    setConfirming(null);
    setError(null);
    setStatus(null);
    const run = async (reason?: string) => {
      await remove.mutateAsync({ photoId: photo.id, reason });
      setStatus(t("visPhotoRemoved"));
    };
    try {
      await run();
    } catch (err) {
      if (needsReason(err)) askReason(t("visRemovePhoto"), run);
      else setError(err);
    }
  }

  function askRemove(photo: VisitPhoto) {
    if (mode === "correct") {
      askReason(t("visRemovePhoto"), async (reason) => {
        await remove.mutateAsync({ photoId: photo.id, reason });
        setStatus(t("visPhotoRemoved"));
      });
    } else setConfirming(photo);
  }

  const thumbs = (photos: VisitPhoto[]) =>
    photos.length > 0 && (
      <ul className="visit-thumbs">
        {photos.map((p) => <Thumb key={p.id} photo={p} canRemove={canRemove(p)} busy={busy} onOpen={() => setViewing(p)} onRemove={() => askRemove(p)} />)}
      </ul>
    );

  const rooms = visit.rooms.filter((r) => writable || visit.photos.some((p) => p.room_id === r.id) || visit.skips.some((s) => s.room_id === r.id));
  return (
    <section className="visit-photos" aria-labelledby={headingId}>
      <h3 id={headingId} ref={headingRef} tabIndex={-1}>{t("visPhotos", { n: visit.photos.length })}</h3>
      <ul className="visit-rooms">
        {rooms.map((room) => {
          const photos = visit.photos.filter((p) => p.room_id === room.id);
          const skip = visit.skips.find((s) => s.room_id === room.id);
          const nameId = `${headingId}-room-${room.id}`;
          return (
            <li key={room.id} className="visit-room" role="group" aria-labelledby={nameId}>
              <h4 id={nameId} className="visit-room__name">{room.name}</h4>
              {thumbs(photos)}
              {skip && <p className="visit-room__skip">{t("visSkipped", { reason: skip.reason, name: skip.skipped_by_name ?? "" })}</p>}
              {writable && <AddPhoto disabled={busy} onFile={(e) => void onFile({ roomId: room.id }, e)} />}
              {writable && visit.photos_required && photos.length === 0 && !skip && (
                <Button variant="ghost" className="visit-room__skip-button" disabled={busy} onClick={() => setSkipping(room)}>{t("visSkipRoom")}</Button>
              )}
            </li>
          );
        })}
        {(writable || others.length > 0) && (
          <li className="visit-room" role="group" aria-labelledby={`${headingId}-other`}>
            <h4 id={`${headingId}-other`} className="visit-room__name">{t("visOtherRoom")}</h4>
            {thumbs(others)}
            {writable && (
              <>
                <TextField label={t("visOtherName")} value={otherName} maxLength={ROOM_NAME_MAX} onChange={(e) => setOtherName(e.target.value)} />
                <AddPhoto disabled={busy || !otherName.trim()} onFile={(e) => void onFile({ otherName: otherName.trim() }, e)} />
              </>
            )}
          </li>
        )}
      </ul>
      <div aria-live="polite" className="visit-status">
        {preparing && <p><span className="spinner" aria-hidden="true" /> {t("visPreparing")}</p>}
        {upload.isPending && <p><span className="spinner" aria-hidden="true" /> {t("visUploading", { percent: Math.round(progress * 100) })}</p>}
        {!busy && status && <p>{status}</p>}
      </div>
      {error !== null && <VisitErrorNotice error={error} />}

      {viewing && (
        <Dialog open size="full" title={viewing.room_name} onClose={() => setViewing(null)}>
          <img className="visit-viewer" src={viewing.url} alt={t("visPhotoOf", { room: viewing.room_name })} />
        </Dialog>
      )}
      {confirming && (
        <Dialog
          open
          title={t("visRemovePhoto")}
          onClose={() => setConfirming(null)}
          footer={
            <>
              <span className="dialog__spacer" />
              <Button variant="ghost" onClick={() => setConfirming(null)}>{t("cancel")}</Button>
              <Button variant="danger" icon="trash" onClick={() => void removeNow(confirming)}>{t("visRemovePhoto")}</Button>
            </>
          }
        >
          <p>{t("visRemovePhotoConfirm")}</p>
        </Dialog>
      )}
      {skipping && <SkipDialog visit={visit} room={skipping} correcting={mode === "correct"} onClose={() => setSkipping(null)} />}
    </section>
  );
});

/** A room left without photos, with why. Once the visit is closed (or its day is over) it is a correction: its own reason
 * goes in `correction_reason` (`reason` is why the room was skipped). */
function SkipDialog({ visit, room, correcting, onClose }: { visit: Visit; room: { id: number; name: string }; correcting: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const formId = useId();
  const mutation = useSkipRoom();
  const [reason, setReason] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [needCorrection, setNeedCorrection] = useState(correcting);
  const ready = reason.trim() !== "" && (!needCorrection || correctionReason.trim() !== "");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready || mutation.isPending) return;
    const input = { room_id: room.id, reason: reason.trim(), ...(needCorrection ? { correction_reason: correctionReason.trim() } : {}) };
    try {
      await mutation.mutateAsync({ eventId: visit.event_id, occurrenceDate: visit.occurrence_date, input });
      onClose();
    } catch (err) {
      if (!needCorrection && needsReason(err)) setNeedCorrection(true);
    }
  }

  const footer = (
    <>
      <span className="dialog__spacer" />
      <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
      <Button type="submit" form={formId} variant="primary" busy={mutation.isPending} disabled={!ready}>{t("visSkipRoom")}</Button>
    </>
  );
  const askedNow = needCorrection && !correcting && mutation.error !== null && needsReason(mutation.error);
  return (
    <Dialog open title={t("visSkipRoom")} onClose={onClose} footer={footer}>
      <form id={formId} className="doc-form" onSubmit={(e) => void submit(e)} noValidate>
        <p className="visit-hint">{room.name}</p>
        <TextAreaField label={t("visSkipReason")} value={reason} maxLength={REASON_MAX} autoFocus required onChange={(e) => setReason(e.target.value)} />
        {needCorrection && <TextAreaField label={t("visCorrectionReason")} hint={t("visCorrectionWhy")} value={correctionReason} maxLength={REASON_MAX} required onChange={(e) => setCorrectionReason(e.target.value)} />}
      </form>
      {askedNow ? <p className="notice" role="status">{visitError(mutation.error, t)}</p> : mutation.error && <VisitErrorNotice error={mutation.error} />}
    </Dialog>
  );
}
