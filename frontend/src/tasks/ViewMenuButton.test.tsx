import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetLanguage, useEnglish } from "../testUtils";
import { ViewMenuButton } from "./ViewMenuButton";

beforeEach(async () => { await useEnglish(); });
afterEach(async () => { await resetLanguage(); });

const setup = (over = {}) => {
  const props = { view: "list" as const, onView: vi.fn(), onManage: vi.fn(), managing: false, ...over };
  render(<ViewMenuButton {...props} />);
  return props;
};

describe("ViewMenuButton", () => {
  it("opens a menu with the two views and the categories", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "View and categories" }));
    expect(screen.getByRole("menuitemradio", { name: "List" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemradio", { name: "Board" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("menuitem", { name: "Manage categories" })).toBeInTheDocument();
  });

  it("choosing Board reports it and closes the menu", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: "View and categories" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Board" }));
    expect(p.onView).toHaveBeenCalledWith("board");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("leaves out Manage categories when the person may not manage them", () => {
    setup({ canManage: false });
    fireEvent.click(screen.getByRole("button", { name: "View and categories" }));
    expect(screen.getByRole("menuitemradio", { name: "List" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Manage categories" })).toBeNull();
  });

  it("Manage categories reports it", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: "View and categories" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Manage categories" }));
    expect(p.onManage).toHaveBeenCalled();
  });

  it("while managing, the gear just takes you back", () => {
    const p = setup({ managing: true });
    fireEvent.click(screen.getByRole("button", { name: "View and categories" }));
    expect(p.onManage).toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on Escape", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "View and categories" }));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
