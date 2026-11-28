import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useSession } from "../session";
import { checkIn, checkOut, correct, getVisit, removePhoto, skipRoom, uploadPhoto, visitReport, visitReportPerson, visitsToday, type CorrectionInput, type PhotoTarget, type SkipInput } from "./api";

export const visitKeys = {
  all: ["visits"] as const,
  today: ["visits", "today"] as const,
  detail: (eventId: number, occurrenceDate: string) => ["visits", "one", eventId, occurrenceDate] as const,
  report: (from: string, to: string) => ["visits", "report", from, to] as const,
  reportPerson: (userId: number, from: string, to: string) => ["visits", "report", from, to, userId] as const,
};

/** The "Visits done" counts of a range (admins); `enabled` is false while the range is not valid. */
export function useVisitReport(from: string, to: string, enabled = true) {
  return useQuery({ queryKey: visitKeys.report(from, to), queryFn: () => visitReport(from, to), enabled, retry: false, staleTime: 30_000 });
}

export function useVisitReportPerson(userId: number | null, from: string, to: string, enabled = true) {
  return useQuery({ queryKey: visitKeys.reportPerson(userId ?? 0, from, to), queryFn: () => visitReportPerson(userId!, from, to), enabled: enabled && userId !== null, retry: false, staleTime: 30_000 });
}

/** Who identifies a visit in the requests. */
export type VisitRef = { eventId: number; occurrenceDate: string };

export function useVisitsToday() {
  return useQuery({ queryKey: visitKeys.today, queryFn: visitsToday, staleTime: 15_000 });
}

export function useVisit(eventId: number, occurrenceDate: string, enabled = true) {
  return useQuery({ queryKey: visitKeys.detail(eventId, occurrenceDate), queryFn: () => getVisit(eventId, occurrenceDate), enabled, retry: false });
}

/** Nothing is changed in place: after every change (and every refusal, since a colleague may have changed the visit) the
 * list of today and the visit pages are read again from the server. */
function useVisitMutation<V, R>(run: (variables: V, csrf: string) => Promise<R>) {
  const { csrfToken } = useSession();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (variables: V) => run(variables, csrfToken),
    onSettled: () => qc.invalidateQueries({ queryKey: visitKeys.all }),
  });
}

export const useCheckIn = () => useVisitMutation(({ eventId, occurrenceDate, people }: VisitRef & { people: number[] }, csrf) => checkIn(eventId, occurrenceDate, people, csrf));
export const useCheckOut = () => useVisitMutation(({ eventId, occurrenceDate, confirmNoPhotos }: VisitRef & { confirmNoPhotos: boolean }, csrf) => checkOut(eventId, occurrenceDate, confirmNoPhotos, csrf));
export const useCorrection = () => useVisitMutation(({ eventId, occurrenceDate, input }: VisitRef & { input: CorrectionInput }, csrf) => correct(eventId, occurrenceDate, input, csrf));
export const useSkipRoom = () => useVisitMutation(({ eventId, occurrenceDate, input }: VisitRef & { input: SkipInput }, csrf) => skipRoom(eventId, occurrenceDate, input, csrf));
export const useRemovePhoto = () => useVisitMutation(({ photoId, reason }: { photoId: number; reason?: string }, csrf) => removePhoto(photoId, reason, csrf));
export const useUploadPhoto = () =>
  useVisitMutation(({ eventId, occurrenceDate, photo, target, reason, onProgress }: VisitRef & { photo: Blob; target: PhotoTarget; reason?: string; onProgress?: (fraction: number) => void }, csrf) =>
    uploadPhoto(eventId, occurrenceDate, photo, target, reason, csrf, onProgress));
