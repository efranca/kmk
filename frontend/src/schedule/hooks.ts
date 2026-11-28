// Server state of the schedule (TanStack Query). Every change invalidates the listings and the reminders.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useSession } from "../session";
import { createEvent, deleteEvent, dismissReminder, dueReminders, getEvent, listOccurrences, listPeople, updateEvent } from "./api";
import type { EventInput, Scope } from "./types";

export const keys = {
  all: ["schedule"] as const,
  occurrences: (from: string, to: string, q: string, people: number[]) => ["schedule", "occurrences", from, to, q, people.join(",")] as const,
  event: (id: number) => ["schedule", "event", id] as const,
  people: ["schedule", "people"] as const,
  reminders: ["schedule", "reminders"] as const,
};

export function useOccurrences(from: string, to: string, opts: { q?: string; people?: number[]; enabled?: boolean } = {}) {
  const q = opts.q?.trim() ?? "";
  const people = opts.people ?? [];
  return useQuery({
    queryKey: keys.occurrences(from, to, q, people),
    queryFn: () => listOccurrences(from, to, { q, people }),
    enabled: opts.enabled ?? true,
    placeholderData: keepPreviousData, // moving to the next week keeps the old one on screen until the new one arrives
  });
}

export function usePeople() {
  return useQuery({ queryKey: keys.people, queryFn: listPeople, staleTime: 60_000 });
}

export function useEvent(id: number | null) {
  return useQuery({ queryKey: keys.event(id ?? 0), queryFn: () => getEvent(id!), enabled: id !== null });
}

/** Creates (no `id`) or changes an event; resolves with the event that now carries the change. */
export function useSaveEvent() {
  const { csrfToken } = useSession();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input, scope = "all", occurrenceDate }: { id?: number; input: EventInput; scope?: Scope; occurrenceDate?: string }) =>
      id === undefined ? createEvent(input, csrfToken) : updateEvent(id, input, scope, occurrenceDate, csrfToken),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.all }),
  });
}

export function useDeleteEvent() {
  const { csrfToken } = useSession();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, scope = "all", occurrenceDate }: { id: number; scope?: Scope; occurrenceDate?: string }) =>
      deleteEvent(id, scope, occurrenceDate, csrfToken),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.all }),
  });
}

/** Reminders that are due now, refreshed every minute while the app is open. */
export function useDueReminders() {
  return useQuery({ queryKey: keys.reminders, queryFn: dueReminders, refetchInterval: 60_000 });
}

export function useDismissReminder() {
  const { csrfToken } = useSession();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, occurrenceDate }: { eventId: number; occurrenceDate: string }) => dismissReminder(eventId, occurrenceDate, csrfToken),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.reminders }),
  });
}
