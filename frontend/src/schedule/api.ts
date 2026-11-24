// The schedule API (backend/app/schedule). Errors come back as {"error": "<code>"} and surface as ApiFailure.
import type { Person } from "../ui/Avatar";
import type { DueReminder, EventDetail, EventInput, Occurrence, Scope } from "./types";

const BASE = "/api/schedule";

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

export async function request<T>(method: string, url: string, csrfToken?: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      credentials: "same-origin",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiFailure(0, "network");
  }
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiFailure(response.status, typeof data?.error === "string" ? data.error : "unknown");
  return data as T;
}

export async function listOccurrences(from: string, to: string, opts: { q?: string; people?: number[] } = {}): Promise<Occurrence[]> {
  const params = new URLSearchParams({ from, to });
  if (opts.q && opts.q.trim().length >= 2) params.set("q", opts.q.trim());
  if (opts.people && opts.people.length > 0) params.set("people", opts.people.join(","));
  return (await request<{ occurrences: Occurrence[] }>("GET", `${BASE}/events?${params}`)).occurrences;
}

export async function getEvent(id: number): Promise<EventDetail> {
  return (await request<{ event: EventDetail }>("GET", `${BASE}/events/${id}`)).event;
}

export async function createEvent(input: EventInput, csrfToken: string): Promise<EventDetail> {
  return (await request<{ event: EventDetail }>("POST", `${BASE}/events`, csrfToken, input)).event;
}

/** Changes an event; for a repeating one `scope` and `occurrenceDate` say which occurrences. Returns the event that now carries the change. */
export async function updateEvent(id: number, input: EventInput, scope: Scope, occurrenceDate: string | undefined, csrfToken: string): Promise<EventDetail> {
  const body = { ...input, scope, occurrence_date: occurrenceDate ?? null };
  return (await request<{ event: EventDetail }>("PATCH", `${BASE}/events/${id}`, csrfToken, body)).event;
}

export async function deleteEvent(id: number, scope: Scope, occurrenceDate: string | undefined, csrfToken: string): Promise<void> {
  const params = new URLSearchParams({ scope });
  if (occurrenceDate) params.set("occurrence_date", occurrenceDate);
  await request("DELETE", `${BASE}/events/${id}?${params}`, csrfToken);
}

export async function listPeople(): Promise<Person[]> {
  return (await request<{ people: Person[] }>("GET", `${BASE}/people`)).people;
}

export async function dueReminders(): Promise<DueReminder[]> {
  return (await request<{ reminders: DueReminder[] }>("GET", `${BASE}/reminders/due`)).reminders;
}

export async function dismissReminder(eventId: number, occurrenceDate: string, csrfToken: string): Promise<void> {
  await request("POST", `${BASE}/reminders/dismiss`, csrfToken, { event_id: eventId, occurrence_date: occurrenceDate });
}
