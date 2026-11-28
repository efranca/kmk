// The visits API (backend/app/visits): today's visits, check-in and check-out, photos, room skips and corrections.
// Errors surface as VisitFailure (an ApiFailure that also carries the rooms of a `409 rooms_missing`).
import { ApiFailure } from "../schedule/api";

export type VisitState = "not_started" | "in_progress" | "closed";
export type VisitPerson = { user_id: number | null; name: string; checked_in_at: string; checked_in_by_name: string | null; self: boolean };
export type ListedPerson = { user_id: number; name: string };
export type VisitPhoto = { id: number; room_id: number | null; room_name: string; uploaded_by_name: string | null; uploaded_at: string; url: string };
export type VisitSkip = { id: number; room_id: number | null; room_name: string; reason: string; skipped_by_name: string | null; skipped_at: string };
export type CorrectionKind = "close" | "withdraw" | "add_person" | "reopen" | "add_photo" | "remove_photo" | "skip_room";
export type VisitCorrection = { kind: CorrectionKind; actor_name: string | null; reason: string; created_at: string; details: Record<string, unknown> };

/** One visit as `visit_payload` sends it; before the first check-in `id` is null. No address, access notes or price. */
export type Visit = {
  id: number | null;
  event_id: number;
  occurrence_date: string;
  date: string;
  title: string | null;
  client_name: string | null;
  property_name: string | null;
  property_id: number | null;
  photos_required: boolean;
  rooms: { id: number; name: string }[];
  state: VisitState;
  people: VisitPerson[];
  listed: ListedPerson[];
  closed_at: string | null;
  closed_by_name: string | null;
  closed_without_photos: boolean;
  corrected: boolean;
  photos: VisitPhoto[];
  photo_count_total: number;
  skips: VisitSkip[];
  corrections: VisitCorrection[];
  can_correct_until: string | null;
};

export type CorrectionInput = { kind: "close" | "withdraw" | "add_person" | "reopen"; reason: string; user_id?: number };
export type SkipInput = { room_id: number; reason: string; correction_reason?: string };
/** Where a photo goes: a room of the property's list, or "Other" with a free name. */
export type PhotoTarget = { roomId: number } | { otherName: string };

export class VisitFailure extends ApiFailure {
  constructor(
    status: number,
    code: string,
    readonly rooms: string[] = [],
  ) {
    super(status, code);
  }
}

const failure = (status: number, data: unknown) => {
  const body = (data && typeof data === "object" ? data : {}) as { error?: unknown; rooms?: unknown };
  const rooms = Array.isArray(body.rooms) ? body.rooms.filter((r): r is string => typeof r === "string") : [];
  return new VisitFailure(status, typeof body.error === "string" ? body.error : status === 413 ? "photo_too_large" : "unknown", rooms);
};

async function call<T>(method: string, url: string, csrfToken?: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let response: Response;
  try {
    response = await fetch(url, { method, credentials: "same-origin", headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new VisitFailure(0, "network");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw failure(response.status, data);
  return data as T;
}

const visitPath = (eventId: number, occurrenceDate: string) => `/api/visits/${eventId}/${occurrenceDate}`;

export const visitsToday = async () => (await call<{ visits: Visit[] }>("GET", "/api/visits/today")).visits;
export const getVisit = async (eventId: number, occurrenceDate: string) => (await call<{ visit: Visit }>("GET", visitPath(eventId, occurrenceDate))).visit;
export const checkIn = async (eventId: number, occurrenceDate: string, people: number[], csrf: string) =>
  (await call<{ visit: Visit }>("POST", `${visitPath(eventId, occurrenceDate)}/checkin`, csrf, { people })).visit;
export const checkOut = async (eventId: number, occurrenceDate: string, confirmNoPhotos: boolean, csrf: string) =>
  (await call<{ visit: Visit }>("POST", `${visitPath(eventId, occurrenceDate)}/checkout`, csrf, { confirm_no_photos: confirmNoPhotos })).visit;
export const correct = async (eventId: number, occurrenceDate: string, input: CorrectionInput, csrf: string) =>
  (await call<{ visit: Visit }>("POST", `${visitPath(eventId, occurrenceDate)}/corrections`, csrf, input)).visit;
export const skipRoom = async (eventId: number, occurrenceDate: string, input: SkipInput, csrf: string) =>
  (await call<{ visit: Visit }>("POST", `${visitPath(eventId, occurrenceDate)}/skips`, csrf, input)).visit;
/** `reason`: the correction's reason, needed once the visit is closed or its day is over (sent as the JSON body). */
export const removePhoto = async (photoId: number, reason: string | undefined, csrf: string) =>
  (await call<{ visit: Visit }>("DELETE", `/api/visit-photos/${photoId}`, csrf, reason === undefined ? undefined : { reason })).visit;

/** Sends the prepared photo as the raw body and reports progress. `reason` (query) makes it a correction. Rejects with VisitFailure. */
export function uploadPhoto(eventId: number, occurrenceDate: string, photo: Blob, target: PhotoTarget, reason: string | undefined, csrf: string, onProgress?: (fraction: number) => void): Promise<Visit> {
  const params = new URLSearchParams();
  if ("roomId" in target) params.set("room_id", String(target.roomId));
  else params.set("other_name", target.otherName);
  if (reason !== undefined) params.set("reason", reason);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `${visitPath(eventId, occurrenceDate)}/photos?${params}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader("X-CSRF-Token", csrf);
    xhr.setRequestHeader("Content-Type", photo.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new VisitFailure(0, "network"));
    xhr.onload = () => {
      let data: unknown = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        // a proxy's page, not ours
      }
      if (xhr.status >= 200 && xhr.status < 300) return resolve((data as { visit: Visit }).visit);
      reject(failure(xhr.status, data));
    };
    xhr.send(photo);
  });
}
