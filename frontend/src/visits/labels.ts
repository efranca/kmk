import type { TFunction } from "i18next";

import { COMPANY_TIME_ZONE, timeIn, todayIn } from "../schedule/scheduleDates";
import { errorMessage } from "../ui/errors";
import type { CorrectionKind, Visit, VisitState } from "./api";

export const STATE_KEYS: Record<VisitState, string> = { not_started: "visStateNotStarted", in_progress: "visStateInProgress", closed: "visStateClosed" };

export const KIND_KEYS: Record<CorrectionKind, string> = {
  close: "visCorrectionClose",
  withdraw: "visCorrectionWithdraw",
  add_person: "visCorrectionAddPerson",
  reopen: "visCorrectionReopen",
  add_photo: "visAddPhoto",
  remove_photo: "visRemovePhoto",
  skip_room: "visSkipRoom",
};

/** Every refusal the visit routes give (and the phone's own photo errors), in the person's words. */
const ERROR_KEYS: Record<string, string> = {
  not_found: "visErrNotFound",
  not_listed: "visErrNotListed",
  already_checked_in: "visErrAlreadyCheckedIn",
  already_closed: "visErrAlreadyClosed",
  not_closed: "visErrNotClosed",
  not_today: "visErrNotToday",
  rooms_missing: "visRoomsMissing",
  no_photos: "visNoPhotosBody",
  not_checked_in: "visErrNotCheckedIn",
  correction_required: "visErrCorrectionRequired",
  correction_window_closed: "visErrWindowClosed",
  invalid_photo: "visErrInvalidPhoto",
  invalid_image: "visErrInvalidPhoto",
  photo_too_large: "visErrPhotoTooLarge",
  storage_full: "visErrStorageFull",
  busy: "visErrBusy",
  timeout: "visErrTimeout",
  invalid_reason: "visErrInvalidReason",
  invalid_room: "visErrInvalidRoom",
  already_skipped: "visErrAlreadySkipped",
  forbidden: "visErrForbidden",
};

export function codeOf(error: unknown): string {
  if (error instanceof Error && !("code" in error)) return error.message; // preparePhoto's Error("photo_too_large")
  return typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
}

export function visitError(error: unknown, t: TFunction): string {
  const key = ERROR_KEYS[codeOf(error)];
  return key ? t(key) : errorMessage(error, t);
}

/** "08:02" in the company's time zone: the proof of when, never a duration. */
export const clock = (iso: string) => timeIn(COMPANY_TIME_ZONE, new Date(iso));

export const formatDay = (day: string, locale: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(`${day}T12:00:00`));

export const companyToday = () => todayIn(COMPANY_TIME_ZONE);
/** The company's date of a moment (a correction made at 23:30 belongs to that day, not to the next one in UTC). */
export const companyDay = (iso: string) => todayIn(COMPANY_TIME_ZONE, new Date(iso));

/**
 * Whether this person may correct the visit now. Only where a correction means something: a closed visit, or a visit
 * (open or never started) whose day is over. Then admins always may; anyone else while `can_correct_until` is in the
 * future (the server sends it only to who was checked in, or to a listed person on a visit never started).
 */
export function canCorrect(visit: Visit, isAdmin: boolean, today: string, now = Date.now()): boolean {
  const meaningful = visit.state === "closed" || visit.date < today;
  if (!meaningful) return false;
  if (isAdmin) return true;
  return visit.can_correct_until !== null && Date.parse(visit.can_correct_until) > now;
}
