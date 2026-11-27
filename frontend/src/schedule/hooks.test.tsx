import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SessionProvider } from "../session";
import { useDeleteEvent, useOccurrences, useSaveEvent } from "./hooks";
import type { EventInput } from "./types";

const user = { id: 1, username: "alice", name: null, email: "a@x.ca", role: "user" as const, locale: "en" as const };
const input: EventInput = {
  title: "Visit", notes: null, icon: null, color: null, all_day: false, start_date: "2026-11-05", start_time: "09:00",
  duration_minutes: 60, recurrence: null, ends_on: null, max_count: null, client_id: null, property_id: null, people: [], reminders: [],
};
const occurrence = { event_id: 1, original_date: "2026-11-05", date: "2026-11-05", start_time: "09:00", end_time: "10:00", all_day: false,
  title: "Visit", notes: null, icon: null, color: "teal", repeating: false, modified: false, people: [], created_by: 1 };

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <SessionProvider value={{ user, csrfToken: "tok-9" }}>{children}</SessionProvider>
    </QueryClientProvider>
  );
}

const reply = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
let list: ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>>;
beforeEach(() => {
  list = vi.fn(async (_url: string, _init?: RequestInit) => reply(200, { occurrences: [occurrence] }));
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if ((init?.method ?? "GET") === "GET" && url.startsWith("/api/schedule/events")) return list(url, init);
    if (init?.method === "POST" && url === "/api/schedule/events") return reply(201, { event: { id: 7 } });
    if (init?.method === "PATCH") return reply(422, { error: "series_field_changed" });
    if (init?.method === "DELETE") return reply(200, { status: "ok" });
    throw new Error(`unexpected ${init?.method ?? "GET"} ${url}`);
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe("schedule hooks", () => {
  it("useOccurrences fetches the range, search and people", async () => {
    const { result } = renderHook(() => useOccurrences("2026-11-01", "2026-11-30", { q: "visit", people: [2, 3] }), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual([occurrence]));
    const url = String(list.mock.calls[0]![0]);
    expect(url).toContain("from=2026-11-01");
    expect(url).toContain("to=2026-11-30");
    expect(url).toContain("q=visit");
    expect(url).toContain("people=2%2C3");
  });

  it("saving an event sends the CSRF token and refetches occurrences", async () => {
    const { result } = renderHook(() => ({ occ: useOccurrences("2026-11-01", "2026-11-30"), save: useSaveEvent() }), { wrapper });
    await waitFor(() => expect(result.current.occ.data).toBeDefined());
    expect(list).toHaveBeenCalledTimes(1);
    await act(async () => { await result.current.save.mutateAsync({ input }); });
    const post = vi.mocked(fetch).mock.calls.find(([, i]) => i?.method === "POST")!;
    expect((post[1]!.headers as Record<string, string>)["X-CSRF-Token"]).toBe("tok-9");
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });

  it("an error code reaches the caller", async () => {
    const { result } = renderHook(() => useSaveEvent(), { wrapper });
    await expect(
      act(async () => { await result.current.mutateAsync({ id: 1, input, scope: "this", occurrenceDate: "2026-11-12" }); }),
    ).rejects.toMatchObject({ code: "series_field_changed", status: 422 });
  });

  it("deleting passes the scope and the occurrence date", async () => {
    const { result } = renderHook(() => useDeleteEvent(), { wrapper });
    await act(async () => { await result.current.mutateAsync({ id: 4, scope: "following", occurrenceDate: "2026-11-19" }); });
    const call = vi.mocked(fetch).mock.calls.find(([, i]) => i?.method === "DELETE")!;
    expect(call[0]).toBe("/api/schedule/events/4?scope=following&occurrence_date=2026-11-19");
  });
});
