import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CategoryChips } from "./CategoryChips";

const options = [{ id: 1, name: "Office", icon: "🏢", count: 2 }, { id: 2, name: "Shop", icon: null, count: 0 }];

describe("CategoryChips", () => {
  it("shows All and the categories that hold tasks, with how many", () => {
    render(<CategoryChips label="Categories" allLabel="All" allCount={5} options={options} selected={null} onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: "All 5" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "🏢 Office 2" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("button", { name: /Shop/ })).toBeNull(); // empty categories are left out
  });

  it("gives a category with no icon the generic one", () => {
    render(<CategoryChips label="Categories" allLabel="All" allCount={5} options={[{ id: 2, name: "Shop", icon: null, count: 1 }]} selected={null} onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: "🏷️ Shop 1" })).toBeInTheDocument();
  });

  it("keeps the picked category visible even when it is empty", () => {
    render(<CategoryChips label="Categories" allLabel="All" allCount={5} options={options} selected={2} onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: "🏷️ Shop 0" })).toHaveAttribute("aria-pressed", "true");
  });

  it("picks a category, and All picks none", () => {
    const onSelect = vi.fn();
    render(<CategoryChips label="Categories" allLabel="All" allCount={5} options={options} selected={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "🏢 Office 2" }));
    expect(onSelect).toHaveBeenLastCalledWith(1);
    fireEvent.click(screen.getByRole("button", { name: "All 5" }));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });
});
