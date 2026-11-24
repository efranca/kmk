import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetLanguage, useEnglish } from "../testUtils";
import { YearView } from "./YearView";

const onOpenMonth = vi.fn();

function renderYear(busy: string[]) {
  return render(<YearView year={2026} busyDates={new Set(busy)} today="2026-11-08" firstDay={0} locale="en-US" onOpenMonth={onOpenMonth} />);
}

beforeEach(async () => {
  onOpenMonth.mockClear();
  await resetLanguage();
  await useEnglish();
});

describe("YearView", () => {
  it("shows a dot only on days with events", () => {
    renderYear(["2026-11-05", "2026-03-02"]);
    expect(document.querySelectorAll(".year__dot")).toHaveLength(2);
    expect(document.querySelector('[data-date="2026-11-05"] .year__dot')).not.toBeNull();
    expect(document.querySelector('[data-date="2026-11-06"] .year__dot')).toBeNull();
  });

  it("shows twelve months and every day of the year once", () => {
    renderYear([]);
    expect(screen.getAllByRole("button", { name: /^(January|February|March|April|May|June|July|August|September|October|November|December)$/ })).toHaveLength(12);
    expect(document.querySelectorAll("[data-date]")).toHaveLength(365);
  });

  it("has no event titles, only day numbers", () => {
    renderYear(["2026-11-05"]);
    expect(document.querySelector('[data-date="2026-11-05"]')?.textContent).toBe("5");
  });

  it("marks today and opens a month on click", async () => {
    renderYear([]);
    expect(document.querySelector('[data-date="2026-11-08"]')?.className).toContain("year__day--today");
    await userEvent.click(screen.getByRole("button", { name: "November" }));
    expect(onOpenMonth).toHaveBeenCalledWith("2026-11-01");
  });
});
