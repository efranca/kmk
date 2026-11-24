import { act, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { mockApi, occurrence, Providers, resetLanguage, useEnglish } from "../testUtils";
import { useMoveEvent } from "./useMoveEvent";
import type { EventDetail } from "./types";

const E = "/api/schedule/events";
const single: EventDetail = {
  id: 1, title: "Piano", notes: null, icon: null, color: null, display_color: "blue", all_day: false, start_date: "2026-11-12", start_time: "10:00",
  duration_minutes: 60, recurrence: null, ends_on: null, max_count: null, people: [], reminders: [], exceptions: [], created_by: 1, updated_by: 1,
};
const weekly: EventDetail = { ...single, start_date: "2026-11-05", recurrence: { freq: "weekly", interval: 1, weekdays: ["THU"], month_day: null, nth_weekdays: [] } };
const item = occurrence({ event_id: 1, title: "Piano", date: "2026-11-12", original_date: "2026-11-12" });
const slot = { date: "2026-11-13", start: "14:00", end: "15:30" };

const wrapper = ({ children }: { children: ReactNode }) => <Providers>{children}</Providers>;
const api = (event: EventDetail) => mockApi({ [`GET ${E}/1`]: () => ({ event }), [`PATCH ${E}/1`]: () => ({ event }) });
const patches = (a: ReturnType<typeof api>) => a.calls.filter((c) => c.method === "PATCH");

beforeEach(async () => {
  await resetLanguage();
  await useEnglish();
});

describe("useMoveEvent", () => {
  it("saves a one-off event at once with the new day and times, and offers Undo", async () => {
    const a = api(single);
    const { result } = renderHook(() => useMoveEvent(), { wrapper });
    await act(async () => { await result.current.move(item, slot); });
    expect(patches(a)).toHaveLength(1);
    expect(patches(a)[0]!.body).toMatchObject({ start_date: "2026-11-13", start_time: "14:00", duration_minutes: 90, scope: "all", all_day: false });
    expect(await screen.findByText("Event moved")).toBeInTheDocument();
    expect(result.current.dialog).toBeNull();
  });

  it("Undo puts the event back where it was", async () => {
    const a = api(single);
    const { result } = renderHook(() => useMoveEvent(), { wrapper });
    await act(async () => { await result.current.move(item, slot); });
    await userEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(patches(a)).toHaveLength(2));
    expect(patches(a)[1]!.body).toMatchObject({ start_date: "2026-11-12", start_time: "10:00", duration_minutes: 60 });
  });

  it("asks which occurrences before saving a repeating event", async () => {
    const a = api(weekly);
    const { result } = renderHook(() => useMoveEvent(), { wrapper });
    await act(async () => { await result.current.move(item, slot); });
    expect(patches(a)).toHaveLength(0);
    expect(result.current.dialog).not.toBeNull();
  });

  it("saves a repeating move with the chosen scope and the occurrence date", async () => {
    const a = api(weekly);
    const { result } = renderHook(() => useMoveEvent(), { wrapper });
    await act(async () => { await result.current.move(item, slot); });
    const { render } = await import("@testing-library/react");
    render(<Providers>{result.current.dialog}</Providers>);
    await userEvent.click(screen.getByRole("radio", { name: "This event" }));
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(patches(a)).toHaveLength(1));
    expect(patches(a)[0]!.body).toMatchObject({ scope: "this", occurrence_date: "2026-11-12", start_date: "2026-11-13", start_time: "14:00" });
  });

  it("shows an error when the event cannot be loaded", async () => {
    mockApi({ [`GET ${E}/1`]: () => ({ ok: false, status: 404, json: async () => ({ error: "not_found" }) }) });
    const { result } = renderHook(() => useMoveEvent(), { wrapper });
    await act(async () => { await result.current.move(item, slot); });
    expect(await screen.findByText("That event no longer exists.")).toBeInTheDocument();
  });
});
