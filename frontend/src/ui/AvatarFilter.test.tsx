import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { person, renderWithProviders, resetLanguage, useEnglish } from "../testUtils";
import { AvatarFilter } from "./AvatarFilter";

const people = [1, 2, 3, 4, 5].map((id) => person(id, `Person ${id}`));

function Harness({ max = 3, initial = [] as number[] }) {
  const [selected, setSelected] = useState<number[]>(initial);
  return (
    <>
      <AvatarFilter people={people} selected={selected} onChange={setSelected} label="Show" everyoneLabel="Everyone"
        moreLabel={(n) => `${n} more people`} max={max} />
      <output data-testid="picked">{selected.join(",")}</output>
    </>
  );
}

beforeEach(async () => {
  await resetLanguage();
  await useEnglish();
});

describe("AvatarFilter", () => {
  it("starts on Everyone and shows the first faces, the rest behind +N", () => {
    renderWithProviders(<Harness />);
    const group = screen.getByRole("group", { name: "Show" });
    expect(within(group).getByRole("button", { name: "Everyone" })).toHaveAttribute("aria-pressed", "true");
    expect(within(group).getAllByRole("button", { name: /^Person [1-3]$/ })).toHaveLength(3);
    expect(within(group).queryByRole("button", { name: "Person 4" })).toBeNull();
    expect(within(group).getByRole("button", { name: "2 more people" })).toBeInTheDocument();
  });

  it("several people can be picked, and Everyone clears them", async () => {
    renderWithProviders(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Person 2" }));
    await userEvent.click(screen.getByRole("button", { name: "Person 1" }));
    expect(screen.getByTestId("picked")).toHaveTextContent("1,2");
    expect(screen.getByRole("button", { name: "Everyone" })).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(screen.getByRole("button", { name: "Person 2" })); // toggles off
    expect(screen.getByTestId("picked")).toHaveTextContent("1");
    await userEvent.click(screen.getByRole("button", { name: "Everyone" }));
    expect(screen.getByTestId("picked")).toHaveTextContent("");
  });

  it("the +N button opens a list with a checkbox for each other person", async () => {
    renderWithProviders(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "2 more people" }));
    const list = screen.getByRole("group", { name: "2 more people" });
    await userEvent.click(within(list).getByRole("checkbox", { name: /Person 5/ }));
    expect(screen.getByTestId("picked")).toHaveTextContent("5");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("group", { name: "2 more people" })).toBeNull();
  });
});
