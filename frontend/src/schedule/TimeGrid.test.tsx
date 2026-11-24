import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { occurrence, resetLanguage, useEnglish } from "../testUtils";
import { TimeGrid } from "./TimeGrid";

beforeEach(async () => {
  await resetLanguage();
  await useEnglish();
});

const piano = occurrence({ title: "Piano", start_time: "10:00", end_time: "11:00", icon: "🎹" });

describe("TimeGrid", () => {
  it("shows one column per day, the weekend ones marked, today highlighted", () => {
    render(<TimeGrid days={["2026-11-12", "2026-11-13", "2026-11-14"]} items={[]} today="2026-11-13" locale="en-US" />);
    expect(screen.getAllByRole("columnheader")).toHaveLength(3);
    expect([...document.querySelectorAll(".grid__col--weekend")].map((c) => c.getAttribute("data-date"))).toEqual(["2026-11-14"]);
    expect(screen.getByRole("columnheader", { current: "date" })).toHaveTextContent("13");
  });

  it("puts every hour of the day in the grid", () => {
    render(<TimeGrid days={["2026-11-12"]} items={[]} today="2026-11-12" locale="en-US" />);
    const hours = [...document.querySelectorAll(".grid__rail .grid__hour")].map((h) => h.textContent);
    expect(hours).toHaveLength(24);
    expect([hours[0], hours[23]]).toEqual(["00:00", "23:00"]);
  });

  it("shows a timed event in its day's column and opens it on click", () => {
    const onOpen = vi.fn();
    render(<TimeGrid days={["2026-11-12"]} items={[piano]} today="2026-11-12" locale="en-US" onOpenItem={onOpen} />);
    const block = screen.getByRole("button", { name: /Piano/ });
    expect(block.closest("[data-date]")?.getAttribute("data-date")).toBe("2026-11-12");
    expect(block).toHaveTextContent("🎹");
    fireEvent.click(block);
    expect(onOpen).toHaveBeenCalledWith(piano);
  });

  it("puts all-day events in the strip on top", () => {
    const holiday = occurrence({ title: "Holiday", all_day: true, start_time: null, end_time: null, date: "2026-11-13", original_date: "2026-11-13" });
    render(<TimeGrid days={["2026-11-12", "2026-11-13"]} items={[holiday]} today="2026-11-12" locale="en-US" />);
    const strip = document.querySelector('.grid__allday[data-date="2026-11-13"]') as HTMLElement;
    expect(within(strip).getByText("Holiday")).toBeInTheDocument();
  });

  it("places overlapping events side by side", () => {
    const a = occurrence({ title: "Alpha", start_time: "10:00", end_time: "11:00" });
    const b = occurrence({ title: "Beta", start_time: "10:30", end_time: "11:30" });
    render(<TimeGrid days={["2026-11-12"]} items={[a, b]} today="2026-11-12" locale="en-US" />);
    expect(screen.getByRole("button", { name: /Alpha/ }).style.width).toContain("50%");
    expect(screen.getByRole("button", { name: /Beta/ }).style.left).toBe("50%");
  });

  it("an empty spot reports the day and a half-hour minute", () => {
    const onCreateAt = vi.fn();
    render(<TimeGrid days={["2026-11-12"]} items={[]} today="2026-11-12" locale="en-US" onCreateAt={onCreateAt} />);
    const column = document.querySelector('.grid__col[data-date="2026-11-12"]') as HTMLElement;
    column.getBoundingClientRect = () => ({ top: 0, height: 1000, left: 0, right: 100, bottom: 1000, width: 100, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.click(column, { clientY: 500 });
    expect(onCreateAt).toHaveBeenCalledTimes(1);
    expect(onCreateAt.mock.calls[0]![0]).toBe("2026-11-12");
    expect(onCreateAt.mock.calls[0]![1] % 30).toBe(0);
  });
});
