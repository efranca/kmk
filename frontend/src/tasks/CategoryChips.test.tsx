import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CategoryChips } from "./CategoryChips";

const options = [{ id: 1, name: "Office", icon: "🏢", count: 2 }, { id: 2, name: "Shop", icon: null, count: 0 }];

describe("CategoryChips", () => {
  it("shows All and every category with how many tasks it has", () => {
    render(<CategoryChips label="Categories" allLabel="All" allCount={5} options={options} selected={null} onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: "All 5" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "🏢 Office 2" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "🏷️ Shop 0" })).toBeInTheDocument(); // a category with no icon gets the generic one
  });

  it("picks a category, and All picks none", () => {
    const onSelect = vi.fn();
    render(<CategoryChips label="Categories" allLabel="All" allCount={5} options={options} selected={1} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "🏷️ Shop 0" }));
    expect(onSelect).toHaveBeenLastCalledWith(2);
    fireEvent.click(screen.getByRole("button", { name: "All 5" }));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });
});
