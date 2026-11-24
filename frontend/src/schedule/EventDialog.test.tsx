import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockApi, occurrence, person, renderWithProviders, resetLanguage, testUser, useEnglish } from "../testUtils";
import { EventDialog, type EventDialogTarget } from "./EventDialog";
import type { EventDetail } from "./types";

const alice = person(1, "Alice", "red");
const leo = person(2, "Leo", "green");

beforeEach(async () => {
  await resetLanguage();
  await useEnglish();
});

const swimmingEvent: EventDetail = {
  id: 1, title: "Swimming", notes: null, icon: "🏊", color: null, display_color: "teal", all_day: false, start_date: "2026-11-05", start_time: "18:00",
  duration_minutes: null,
  recurrence: { freq: "weekly", interval: 1, weekdays: ["THU"], month_day: null, nth_weekdays: [] },
  ends_on: null, max_count: null, people: [], reminders: [{ amount: 1, unit: "days" }],
  created_by: 1, updated_by: 1, exceptions: [],
};

const swimmingOccurrence = occurrence({ event_id: 1, title: "Swimming", date: "2026-11-12", original_date: "2026-11-12", repeating: true });
const E = "/api/schedule/events";

function setup(target: EventDialogTarget, session = {}) {
  const api = mockApi({
    "GET /api/schedule/people": () => ({ people: [alice, leo] }),
    [`GET ${E}/1`]: () => ({ event: swimmingEvent }),
    [`POST ${E}`]: () => ({ event: swimmingEvent }),
    [`PATCH ${E}/1`]: () => ({ event: swimmingEvent }),
    [`DELETE ${E}/1`]: () => ({ status: "ok" }),
  });
  const onClose = vi.fn();
  renderWithProviders(<EventDialog target={target} onClose={onClose} />, { session });
  return { api, onClose };
}

const newSwimming: EventDialogTarget = { kind: "new", date: "2026-11-05", minutes: 18 * 60 }; // a Thursday, 18:00
const bodyOf = (api: ReturnType<typeof setup>["api"], method: string) => api.calls.find((c) => c.method === method)?.body;

describe("EventDialog: new event", () => {
  it("savingANewSwimmingEventPostsTheExpectedBody", async () => {
    const { api, onClose } = setup(newSwimming);
    await userEvent.type(await screen.findByLabelText("Title"), "Swimming");
    await userEvent.selectOptions(screen.getByLabelText("Repeat"), "weekly"); // Thursday is picked for the date
    await userEvent.click(screen.getByRole("button", { name: "Add reminder" }));
    await userEvent.click(screen.getByRole("button", { name: "Add reminder" }));
    await userEvent.clear(screen.getByLabelText("Reminder 2 amount"));
    await userEvent.type(screen.getByLabelText("Reminder 2 amount"), "2");
    await userEvent.selectOptions(screen.getByLabelText("Reminder 2 unit"), "hours");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(bodyOf(api, "POST")).toBeDefined());
    expect(bodyOf(api, "POST")).toEqual({
      title: "Swimming", notes: null, icon: null, color: null, all_day: false, start_date: "2026-11-05", start_time: "18:00",
      duration_minutes: null, people: [], recurrence: { freq: "weekly", interval: 1, weekdays: ["THU"], month_day: null, nth_weekdays: [] },
      ends_on: null, max_count: null, reminders: [{ amount: 1, unit: "days" }, { amount: 2, unit: "hours" }],
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("everyWeekdayIsOfferedAfterEveryDayAndSavesMondayToFriday", async () => {
    const { api } = setup(newSwimming);
    const select = await screen.findByLabelText("Repeat");
    const labels = Array.from(select.querySelectorAll("option")).map((o) => o.textContent);
    expect(labels.indexOf("Every weekday")).toBe(labels.indexOf("Every day") + 1);
    await userEvent.type(screen.getByLabelText("Title"), "School run");
    await userEvent.selectOptions(select, "weekday");
    expect(screen.getByText("Every weekday", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fri" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Sat" })).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(bodyOf(api, "POST")).toBeDefined());
    expect(bodyOf(api, "POST")).toMatchObject({ recurrence: { freq: "weekly", interval: 1, weekdays: ["MON", "TUE", "WED", "THU", "FRI"] } });
  });

  it("unpressingADayTurnsEveryWeekdayBackIntoEveryWeek", async () => {
    setup(newSwimming);
    const select = await screen.findByLabelText("Repeat");
    await userEvent.selectOptions(select, "weekday");
    await userEvent.click(screen.getByRole("button", { name: "Fri" }));
    expect(select).toHaveValue("weekly");
    expect(screen.getByRole("button", { name: "Mon" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Thu" })).toHaveAttribute("aria-pressed", "true");
  });

  it("theRepeatRuleIsDescribedInWords", async () => {
    setup(newSwimming);
    await userEvent.selectOptions(await screen.findByLabelText("Repeat"), "weekly");
    expect(screen.getByText("Every Thursday")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tue" })); // twice a week
    expect(screen.getByText("Every Tuesday and Thursday")).toBeInTheDocument();
  });

  it("fourthSaturdayIsBuiltFromTheMonthlyNthWeekdayControls", async () => {
    const { api } = setup({ kind: "new", date: "2026-11-28", minutes: 600 });
    await userEvent.type(await screen.findByLabelText("Title"), "Music rehearsal");
    await userEvent.selectOptions(screen.getByLabelText("Repeat"), "monthly");
    await userEvent.click(screen.getByRole("radio", { name: "On the weekday" }));
    expect(screen.getByLabelText("Which one 1")).toHaveValue("4"); // 28 November 2026 is the 4th Saturday
    expect(screen.getByLabelText("Weekday 1")).toHaveValue("SAT");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(bodyOf(api, "POST")).toBeDefined());
    expect((bodyOf(api, "POST") as { recurrence: unknown }).recurrence)
      .toEqual({ freq: "monthly", interval: 1, weekdays: [], month_day: null, nth_weekdays: [{ nth: 4, day: "SAT" }] });
  });

  it("allDayHidesTimeFields", async () => {
    setup(newSwimming);
    expect(await screen.findByLabelText("Start time")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: "All day" }));
    expect(screen.queryByLabelText("Start time")).toBeNull();
    expect(screen.queryByLabelText("End time")).toBeNull();
  });

  it("addReminderButtonDisabledAtTenAndARemovedOneFreesASlot", async () => {
    setup(newSwimming);
    const add = await screen.findByRole("button", { name: "Add reminder" });
    for (let i = 0; i < 10; i++) {
      if ((add as HTMLButtonElement).disabled) break;
      await userEvent.click(add);
      await userEvent.clear(screen.getByLabelText(`Reminder ${i + 1} amount`));
      await userEvent.type(screen.getByLabelText(`Reminder ${i + 1} amount`), String(i + 1));
    }
    expect(add).toBeDisabled();
    expect(screen.getAllByRole("button", { name: /Remove reminder/ })).toHaveLength(10);
    await userEvent.click(screen.getByRole("button", { name: "Remove reminder 10" }));
    expect(add).toBeEnabled();
  });

  it("monthDay31ShowsSkipWarning", async () => {
    setup(newSwimming);
    await userEvent.selectOptions(await screen.findByLabelText("Repeat"), "monthly");
    expect(screen.queryByText(/skipped/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Day of the month"), { target: { value: "31" } });
    expect(screen.getByText(/skipped/)).toBeInTheDocument();
  });

  it("everyoneChipClearsPeople", async () => {
    const { api } = setup(newSwimming);
    await userEvent.type(await screen.findByLabelText("Title"), "Dinner");
    await userEvent.click(screen.getByRole("button", { name: "Leo" }));
    expect(screen.getByRole("button", { name: "Leo" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Everyone" })).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(screen.getByRole("button", { name: "Everyone" }));
    expect(screen.getByRole("button", { name: "Leo" })).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(bodyOf(api, "POST")).toBeDefined());
    expect((bodyOf(api, "POST") as { people: number[] }).people).toEqual([]);
  });

  it("aMissingTitleBlocksSaving", async () => {
    const { api } = setup(newSwimming);
    await userEvent.click(await screen.findByRole("button", { name: "Save" }));
    expect(await screen.findByText("Give the event a title")).toBeInTheDocument();
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("aPlainUserCanOpenTheDialogAndSave", async () => {
    const { api } = setup(newSwimming, { user: { ...testUser, role: "user" } });
    await userEvent.type(await screen.findByLabelText("Title"), "Football");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(bodyOf(api, "POST")).toBeDefined());
  });
});

describe("EventDialog: an existing repeating event", () => {
  it("opensWithTheEventsValuesOnTheOccurrencesDate", async () => {
    setup({ kind: "item", item: swimmingOccurrence });
    expect(await screen.findByDisplayValue("Swimming")).toBeInTheDocument();
    expect(screen.getByLabelText("Date")).toHaveValue("2026-11-12");
    expect(screen.getByLabelText("Repeat")).toHaveValue("weekly");
    expect(screen.getByText("Every Thursday")).toBeInTheDocument();
  });

  it("editingARepeatingOccurrenceAsksForScopeBeforeSaving", async () => {
    const { api } = setup({ kind: "item", item: swimmingOccurrence });
    const title = await screen.findByDisplayValue("Swimming");
    await userEvent.clear(title);
    await userEvent.type(title, "Swim club");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Edit repeating event")).toBeInTheDocument();
    expect(api.calls.some((c) => c.method === "PATCH")).toBe(false);
    await userEvent.click(screen.getByRole("radio", { name: "This and following events" }));
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(bodyOf(api, "PATCH")).toBeDefined());
    expect(bodyOf(api, "PATCH")).toMatchObject({ title: "Swim club", scope: "following", occurrence_date: "2026-11-12", start_date: "2026-11-12" });
  });

  it("scopeThisKeepsTheOccurrenceDateAndScopeAllKeepsTheSeriesStart", async () => {
    const { api } = setup({ kind: "item", item: swimmingOccurrence });
    await screen.findByDisplayValue("Swimming");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await userEvent.click(await screen.findByRole("radio", { name: "All events" }));
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(bodyOf(api, "PATCH")).toBeDefined());
    // the form showed the 12th, but the whole series still starts on the 5th
    expect(bodyOf(api, "PATCH")).toMatchObject({ scope: "all", start_date: "2026-11-05" });
  });

  it("changingTheDateForAllEventsShiftsTheSeries", async () => {
    const { api } = setup({ kind: "item", item: swimmingOccurrence });
    await screen.findByDisplayValue("Swimming");
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-11-13" } }); // one day later
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await userEvent.click(await screen.findByRole("radio", { name: "All events" }));
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(bodyOf(api, "PATCH")).toBeDefined());
    expect(bodyOf(api, "PATCH")).toMatchObject({ scope: "all", start_date: "2026-11-06" });
  });

  it("deletingARepeatingOccurrenceAsksForScope", async () => {
    const { api, onClose } = setup({ kind: "item", item: swimmingOccurrence });
    await screen.findByDisplayValue("Swimming");
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Delete repeating event")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "This event" }));
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "DELETE")).toBe(true));
    const call = api.calls.find((c) => c.method === "DELETE")!;
    expect(call.path).toBe("/api/schedule/events/1");
    expect(call.query).toContain("scope=this");
    expect(call.query).toContain("occurrence_date=2026-11-12");
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("cancellingTheScopeQuestionGoesBackToTheForm", async () => {
    const { api } = setup({ kind: "item", item: swimmingOccurrence });
    await screen.findByDisplayValue("Swimming");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(screen.getByDisplayValue("Swimming")).toBeInTheDocument();
    expect(api.calls.some((c) => c.method === "PATCH")).toBe(false);
  });
});

describe("EventDialog: findings of the review", () => {
  it("reopeningAnOccurrenceChangedWithThisEventOnlyShowsTheChange", async () => {
    const changed: EventDetail = { ...swimmingEvent, exceptions: [{ original_date: "2026-11-12", cancelled: false, title: "Early swim",
      notes: null, start_date: "2026-11-12", start_time: "07:00", duration_minutes: 60 }] };
    mockApi({ "GET /api/schedule/people": () => ({ people: [alice] }), [`GET ${E}/1`]: () => ({ event: changed }) });
    renderWithProviders(<EventDialog target={{ kind: "item", item: occurrence({ event_id: 1, title: "Early swim", date: "2026-11-12",
      original_date: "2026-11-12", start_time: "07:00", end_time: "08:00", repeating: true }) }} onClose={vi.fn()} />);
    expect(await screen.findByDisplayValue("Early swim")).toBeInTheDocument();
    expect(screen.getByLabelText("Start time")).toHaveValue("07:00");
    expect(screen.getByLabelText(/^End time/)).toHaveValue("08:00");
  });

  it("thisEventIsNotOfferedWhenSomethingOfTheWholeSeriesChanged", async () => {
    const { api } = setup({ kind: "item", item: swimmingOccurrence });
    await screen.findByDisplayValue("Swimming");
    await userEvent.click(await screen.findByRole("button", { name: "Leo" })); // people belong to the whole series
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Edit repeating event")).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "This event" })).toBeNull();
    expect(screen.getByText(/applies to the whole series/)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "This and following events" })).toBeChecked(); // the first allowed one
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(bodyOf(api, "PATCH")).toBeDefined());
    expect(bodyOf(api, "PATCH")).toMatchObject({ scope: "following", people: [2] });
  });

  it("thisEventIsStillOfferedWhenOnlyTheTitleAndTimeChanged", async () => {
    setup({ kind: "item", item: swimmingOccurrence });
    const title = await screen.findByDisplayValue("Swimming");
    await userEvent.clear(title);
    await userEvent.type(title, "Swim club");
    fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "07:00" } });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("radio", { name: "This event" })).toBeInTheDocument();
  });

  it("changingTheDateOfANewWeeklyEventMovesItsWeekday", async () => {
    setup(newSwimming); // Thursday 5 November
    await userEvent.selectOptions(await screen.findByLabelText("Repeat", { exact: true }), "weekly");
    expect(screen.getByText("Every Thursday")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-11-06" } }); // Friday
    expect(screen.getByText("Every Friday")).toBeInTheDocument();
  });

  it("aNewEventWhoseDateIsNotOneOfItsRepeatDaysIsRefusedBeforeSaving", async () => {
    const { api } = setup(newSwimming);
    await userEvent.type(await screen.findByLabelText("Title"), "Swimming");
    await userEvent.selectOptions(screen.getByLabelText("Repeat", { exact: true }), "weekly");
    await userEvent.click(screen.getByRole("button", { name: "Tue" })); // Tuesday and Thursday
    await userEvent.click(screen.getByRole("button", { name: "Thu" })); // Tuesday only
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-11-06" } }); // a Friday
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("The first date must be one of the repeat days")).toBeInTheDocument();
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
  });
});

describe("EventDialog: a single event", () => {
  const single = { ...swimmingEvent, recurrence: null, reminders: [], exceptions: [] } as EventDetail;

  it("deletingASingleEventAsksToConfirmThenDeletesIt", async () => {
    const api = mockApi({ "GET /api/schedule/people": () => ({ people: [alice] }), [`GET ${E}/1`]: () => ({ event: single }), [`DELETE ${E}/1`]: () => ({ status: "ok" }) });
    renderWithProviders(<EventDialog target={{ kind: "item", item: occurrence({ event_id: 1, title: "Swimming", date: "2026-11-05", original_date: "2026-11-05" }) }} onClose={vi.fn()} />);
    await screen.findByDisplayValue("Swimming");
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.queryByRole("radio", { name: "This event" })).toBeNull();
    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "DELETE")).toBe(true));
    expect(api.calls.find((c) => c.method === "DELETE")!.query).toBe("?scope=all");
  });

  it("savingASingleEventNeverAsksForScope", async () => {
    const api = mockApi({ "GET /api/schedule/people": () => ({ people: [alice] }), [`GET ${E}/1`]: () => ({ event: single }), [`PATCH ${E}/1`]: () => ({ event: single }) });
    renderWithProviders(<EventDialog target={{ kind: "item", item: occurrence({ event_id: 1, title: "Swimming", date: "2026-11-05", original_date: "2026-11-05" }) }} onClose={vi.fn()} />);
    await screen.findByDisplayValue("Swimming");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(api.calls.find((c) => c.method === "PATCH")!.body).toMatchObject({ scope: "all", start_date: "2026-11-05" });
  });
});

describe("EventDialog: a person whose account was disabled", () => {
  it("stays on the event and can be taken off it, but is not offered for new events", async () => {
    const gone = { ...person(5, "Gaby Gone", "pink"), active: false };
    mockApi({
      "GET /api/schedule/people": () => ({ people: [alice, leo, gone] }),
      [`GET ${E}/1`]: () => ({ event: { ...swimmingEvent, recurrence: null, reminders: [], people: [1, 5] } }),
      [`PATCH ${E}/1`]: () => ({ event: swimmingEvent }),
    });
    renderWithProviders(<EventDialog target={{ kind: "item", item: occurrence({ event_id: 1, title: "Swimming", date: "2026-11-05", original_date: "2026-11-05" }) }} onClose={vi.fn()} />);
    const face = await screen.findByRole("button", { name: "Gaby Gone" });
    expect(face).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(face);
    expect(screen.queryByRole("button", { name: "Gaby Gone" })).toBeNull(); // taken off, and not offered again
  });

  it("is not offered when adding a new event", async () => {
    const gone = { ...person(5, "Gaby Gone", "pink"), active: false };
    mockApi({ "GET /api/schedule/people": () => ({ people: [alice, leo, gone] }) });
    renderWithProviders(<EventDialog target={newSwimming} onClose={vi.fn()} />);
    await screen.findByRole("button", { name: "Leo" });
    expect(screen.queryByRole("button", { name: "Gaby Gone" })).toBeNull();
  });
});

describe("EventDialog: who may change an event", () => {
  const others = { ...swimmingEvent, recurrence: null, reminders: [], exceptions: [], created_by: 99, people: [2] } as EventDetail;
  const open = (event: EventDetail, session = {}) => {
    mockApi({ "GET /api/schedule/people": () => ({ people: [alice, leo] }), [`GET ${E}/1`]: () => ({ event }) });
    renderWithProviders(<EventDialog target={{ kind: "item", item: occurrence({ event_id: 1, title: "Swimming", date: "2026-11-05", original_date: "2026-11-05" }) }} onClose={vi.fn()} />, { session });
  };

  it("shows an event someone else made, for someone else, read-only: no Save, no Delete", async () => {
    open(others);
    expect(await screen.findByDisplayValue("Swimming")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.getByText("You can only view this event.")).toBeInTheDocument();
  });

  it("lets a person the event is for change it", async () => {
    open(others, { user: { ...testUser, id: 2, username: "leo" } });
    expect(await screen.findByDisplayValue("Swimming")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("lets an admin change any event", async () => {
    open(others, { user: { ...testUser, id: 3, role: "admin" } });
    expect(await screen.findByDisplayValue("Swimming")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("shows the reason when the server refuses", async () => {
    mockApi({
      "GET /api/schedule/people": () => ({ people: [alice, leo] }),
      [`POST ${E}`]: () => ({ ok: false, status: 422, json: async () => ({ error: "unknown_person" }) }),
    });
    renderWithProviders(<EventDialog target={newSwimming} onClose={vi.fn()} />);
    await userEvent.type(await screen.findByLabelText("Title"), "Dinner");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("no longer");
  });
});
