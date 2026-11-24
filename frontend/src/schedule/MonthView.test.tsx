import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { occurrence, resetLanguage, useEnglish } from "../testUtils";
import { MonthView } from "./MonthView";
import type { Occurrence } from "./types";

const onOpenDay = vi.fn();
const onOpenItem = vi.fn();

function renderMonth(items: Occurrence[], firstDay: 0 | 1 = 0) {
  return render(<MonthView year={2026} month={11} items={items} today="2026-11-08" firstDay={firstDay} locale="en-US" onOpenDay={onOpenDay} onOpenItem={onOpenItem} />);
}

const five = Array.from({ length: 5 }, (_, i) => occurrence({ title: `Event ${i + 1}`, start_time: `0${i + 8}:00`, end_time: `0${i + 9}:00` }));

beforeEach(async () => {
  onOpenDay.mockClear();
  onOpenItem.mockClear();
  await resetLanguage();
  await useEnglish();
});

describe("MonthView", () => {
  it("shows three chips then +N more", () => {
    renderMonth(five);
    const cell = document.querySelector('[data-date="2026-11-12"]') as HTMLElement;
    expect(within(cell).getAllByRole("button", { name: /^Event/ })).toHaveLength(3);
    expect(within(cell).getByRole("button", { name: "+2 more" })).toBeInTheDocument();
    expect(within(cell).queryByText("Event 4")).toBeNull();
  });

  it("a day with three or fewer shows them all without more", () => {
    renderMonth(five.slice(0, 3));
    expect(screen.queryByRole("button", { name: /more/ })).toBeNull();
  });

  it("clicking a day, or +N more, opens its Day view", async () => {
    renderMonth(five);
    await userEvent.click(screen.getByRole("button", { name: /November 12/ }));
    expect(onOpenDay).toHaveBeenCalledWith("2026-11-12");
    await userEvent.click(screen.getByRole("button", { name: "+2 more" }));
    expect(onOpenDay).toHaveBeenLastCalledWith("2026-11-12");
  });

  it("clicking an event opens the event", async () => {
    renderMonth([five[0]!]);
    await userEvent.click(screen.getByRole("button", { name: "Event 1" }));
    expect(onOpenItem).toHaveBeenCalledWith(five[0]);
  });

  it("dims days outside the month, marks today, and always shows six weeks", () => {
    renderMonth([], 1); // a Monday-first grid starts on 26 October
    expect(document.querySelector('[data-date="2026-10-31"]')?.className).toContain("month__day--outside");
    expect(document.querySelector('[data-date="2026-11-12"]')?.className).not.toContain("month__day--outside");
    expect(document.querySelector('[data-date="2026-11-08"]')?.className).toContain("month__day--today");
    expect(document.querySelectorAll("[data-date]")).toHaveLength(42);
  });

  it("weekday headers follow the first day of the week", () => {
    renderMonth([], 1);
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  });
});
