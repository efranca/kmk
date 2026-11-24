import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { mockApi, renderWithProviders, reply, resetLanguage, useEnglish } from "../testUtils";
import { ReminderTray } from "./ReminderTray";
import type { DueReminder } from "./types";

const swimming: DueReminder = {
  event_id: 1, occurrence_date: "2026-11-05", title: "Swimming", start_date: "2026-11-05", start_time: "18:00", all_day: false, remind_at: "2026-11-05T16:00",
};
const DUE = "GET /api/schedule/reminders/due";
const DISMISS = "POST /api/schedule/reminders/dismiss";

beforeEach(async () => {
  await resetLanguage();
  await useEnglish();
});

describe("ReminderTray", () => {
  it("shows a due reminder, and dismissing it calls the API and hides it", async () => {
    let due = [swimming];
    const api = mockApi({
      [DUE]: () => ({ reminders: due }),
      [DISMISS]: () => {
        due = [];
        return reply(204);
      },
    });
    renderWithProviders(<ReminderTray />);
    expect(await screen.findByText("Swimming")).toBeInTheDocument();
    expect(screen.getByText(/18:00/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Dismiss reminder for Swimming" }));
    await waitFor(() => expect(screen.queryByText("Swimming")).toBeNull());
    const post = api.calls.find((c) => c.method === "POST")!;
    expect(post.body).toEqual({ event_id: 1, occurrence_date: "2026-11-05" });
  });

  it("an all-day event has no time", async () => {
    mockApi({ [DUE]: () => ({ reminders: [{ ...swimming, all_day: true, start_time: null, title: "Holiday" }] }) });
    renderWithProviders(<ReminderTray />);
    expect(await screen.findByText("Holiday")).toBeInTheDocument();
    expect(screen.getByText(/all day/i)).toBeInTheDocument();
  });

  it("renders nothing when none is due", async () => {
    const api = mockApi({ [DUE]: () => ({ reminders: [] }) });
    const { container } = renderWithProviders(<ReminderTray />);
    await waitFor(() => expect(api.calls.some((c) => c.path === "/api/schedule/reminders/due")).toBe(true));
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector(".reminders")).toBeNull();
  });

  it("shows several reminders, one card each", async () => {
    mockApi({ [DUE]: () => ({ reminders: [swimming, { ...swimming, event_id: 2, title: "Cadets" }] }) });
    renderWithProviders(<ReminderTray />);
    expect(await screen.findByText("Cadets")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Dismiss reminder/ })).toHaveLength(2);
  });

  it("a failed poll shows nothing and keeps the page usable", async () => {
    const api = mockApi({ [DUE]: () => reply(500, { error: "internal_error" }) });
    const { container } = renderWithProviders(<ReminderTray />);
    await waitFor(() => expect(api.calls.length).toBeGreaterThan(0));
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector(".reminders")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
