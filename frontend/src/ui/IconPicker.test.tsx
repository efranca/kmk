import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { renderWithProviders, resetLanguage, useEnglish } from "../testUtils";
import { IconPicker } from "./IconPicker";

function Harness() {
  const [icon, setIcon] = useState("");
  return (
    <>
      <IconPicker value={icon} onChange={setIcon} label="Icon" />
      <output data-testid="icon">{icon}</output>
    </>
  );
}

beforeEach(async () => {
  await resetLanguage();
  await useEnglish();
});

describe("IconPicker", () => {
  it("opens a grid, picks an emoji, and can clear it", async () => {
    renderWithProviders(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Icon" }));
    await userEvent.click(screen.getByRole("button", { name: "🧹" }));
    expect(screen.getByTestId("icon")).toHaveTextContent("🧹");
    expect(screen.queryByRole("group", { name: "Icon" })).toBeNull(); // closes after a choice
    await userEvent.click(screen.getByRole("button", { name: "Icon" }));
    await userEvent.click(screen.getByRole("button", { name: "No icon" }));
    expect(screen.getByTestId("icon")).toHaveTextContent("");
  });
});
