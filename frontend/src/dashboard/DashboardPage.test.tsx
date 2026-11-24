import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";

import { addDays, COMPANY_TIME_ZONE, todayIn } from "../schedule/scheduleDates";
import type { Occurrence } from "../schedule/types";
import { mockApi, occurrence, person, renderWithProviders, reply, resetLanguage, testUser, useEnglish } from "../testUtils";
import { DashboardPage } from "./DashboardPage";

const today = todayIn(COMPANY_TIME_ZONE);
const inDays = (n: number) => addDays(today, n);
const alice = person(1, "Alice Roy", "red"); // the signed-in user (testUser.id = 1)
const leo = person(2, "Leo Tremblay", "green");

const at = (day: number, over: Partial<Occurrence>) => occurrence({ date: inDays(day), original_date: inDays(day), ...over });

function Probe() {
  const location = useLocation();
  return <output data-testid="where">{location.pathname + location.search}</output>;
}

function setup(items: Occurrence[], props = {}) {
  const api = mockApi({
    "GET /api/schedule/events": () => ({ occurrences: items }),
    "GET /api/schedule/people": () => ({ people: [alice, leo] }),
  });
  renderWithProviders(<><DashboardPage user={testUser} mfaEnabled recoveryCodesLeft={null} {...props} /><Probe /></>);
  return api;
}

const card = (name: string) => screen.getByRole("region", { name });

beforeEach(async () => {
  await resetLanguage();
  await useEnglish();
});

describe("DashboardPage", () => {
  it("greets the person by name and asks for today and the next seven days, once", async () => {
    const api = setup([]);
    expect(screen.getByRole("heading", { level: 1, name: "Hello, Alice Roy" })).toBeInTheDocument();
    await screen.findAllByText("Nothing planned.");
    const calls = api.calls.filter((c) => c.path === "/api/schedule/events");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.query).toContain(`from=${today}`);
    expect(calls[0]!.query).toContain(`to=${inDays(7)}`);
  });

  it("My events has the events I am on and events for everyone, not other people's", async () => {
    setup([
      at(0, { title: "My visit", people: [1] }),
      at(0, { title: "Team meeting", people: [] }),
      at(0, { title: "Leo only", people: [2] }),
    ]);
    await screen.findAllByText("My visit");
    const mine = within(screen.getByRole("region", { name: "My events" }));
    expect(mine.getByText("My visit")).toBeInTheDocument();
    expect(mine.getByText("Team meeting")).toBeInTheDocument();
    expect(mine.queryByText("Leo only")).toBeNull();
  });

  it("My events splits Today from Upcoming", async () => {
    setup([at(0, { title: "Now thing", people: [1] }), at(3, { title: "Later thing", people: [1] })]);
    await screen.findAllByText("Now thing");
    const mine = within(screen.getByRole("region", { name: "My events" }));
    const todayList = mine.getByRole("list", { name: "Today" });
    const upcomingList = mine.getByRole("list", { name: "Upcoming" });
    expect(within(todayList).getByText("Now thing")).toBeInTheDocument();
    expect(within(upcomingList).getByText("Later thing")).toBeInTheDocument();
  });

  it("All events shows the Everyone group first, then one group per person", async () => {
    setup([
      at(1, { title: "Holiday", all_day: true, start_time: null, end_time: null, people: [] }),
      at(0, { title: "Leo visit", people: [2] }),
      at(0, { title: "Alice visit", people: [1] }),
    ]);
    await screen.findAllByText("Leo visit");
    const all = within(screen.getByRole("region", { name: "All events" }));
    const groups = all.getAllByRole("group").map((g) => g.getAttribute("aria-label"));
    expect(groups).toEqual(["Everyone", "Alice Roy", "Leo Tremblay"]);
    expect(within(all.getByRole("group", { name: "Leo Tremblay" })).getByText("Leo visit")).toBeInTheDocument();
    expect(within(all.getByRole("group", { name: "Everyone" })).getByText("Holiday")).toBeInTheDocument();
  });

  it("a long list is cut short with +N more that opens the schedule", async () => {
    setup(Array.from({ length: 7 }, (_, i) => at(0, { title: `Job ${i + 1}`, people: [2], start_time: `0${i + 1}:00`, end_time: `0${i + 1}:30` })));
    await screen.findAllByText("Job 1");
    const group = within(screen.getByRole("group", { name: "Leo Tremblay" }));
    expect(group.getAllByRole("button", { name: /^.*Job/ })).toHaveLength(4);
    await userEvent.click(group.getByRole("button", { name: "+3 more" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/schedule");
  });

  it("shows an empty state when nothing is planned", async () => {
    setup([]);
    expect(await within(await screen.findByRole("region", { name: "My events" })).findByText("Nothing planned.")).toBeInTheDocument();
    expect(within(card("All events")).getByText("Nothing planned.")).toBeInTheDocument();
  });

  it("clicking a row opens that day in the schedule, and a card title opens the schedule", async () => {
    setup([at(2, { title: "Window cleaning", people: [1] })]);
    await screen.findAllByText("Window cleaning");
    const mine = within(screen.getByRole("region", { name: "My events" }));
    await userEvent.click(mine.getByRole("button", { name: /Window cleaning/ }));
    expect(screen.getByTestId("where")).toHaveTextContent(`/schedule?view=day&date=${inDays(2)}`);
    await userEvent.click(mine.getByRole("link", { name: "My events" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/schedule");
  });

  it("an error shows a retry on the cards instead of crashing the page", async () => {
    mockApi({
      "GET /api/schedule/events": () => reply(500, { error: "internal_error" }),
      "GET /api/schedule/people": () => ({ people: [alice] }),
    });
    renderWithProviders(<DashboardPage user={testUser} mfaEnabled recoveryCodesLeft={null} />);
    expect((await screen.findAllByRole("button", { name: "Try again" })).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it("keeps the two-step encouragement and the recovery-codes notice that the old welcome page had", async () => {
    setup([], { mfaEnabled: false, recoveryCodesLeft: 2, user: { ...testUser, role: "admin" } });
    expect(await screen.findByText(/two-step|vérification en deux/i)).toBeInTheDocument();
    expect(screen.getByText(/2 recovery code/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText("Nothing planned.").length).toBe(2));
  });
});
