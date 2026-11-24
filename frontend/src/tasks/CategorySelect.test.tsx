import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockApi, renderWithProviders, resetLanguage, useEnglish } from "../testUtils";
import { CategorySelect } from "./CategorySelect";

beforeEach(async () => { await useEnglish(); });
afterEach(async () => { vi.unstubAllGlobals(); await resetLanguage(); });

describe("CategorySelect", () => {
  it("offers no category and every category with its icon (a generic one when it has none)", async () => {
    mockApi({ "GET /api/tasks/categories": { categories: [{ id: 1, name: "Office", icon: "🏢" }, { id: 2, name: "Shop", icon: null }] } });
    const onChange = vi.fn();
    renderWithProviders(<CategorySelect value={null} onChange={onChange} />);
    expect(await screen.findByRole("option", { name: "🏢 Office" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "🏷️ Shop" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "No category" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "2" } });
    expect(onChange).toHaveBeenCalledWith(2);
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});
