import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import "../i18n";
import { Avatar } from "./Avatar";
import { AvatarGroup } from "./AvatarGroup";
import { EVENT_COLORS, eventColorVar, initials, memberColor } from "./memberColor";

const maria = { id: 1, name: "Maria Silva", color: "red" as const };
const bob = { id: 2, name: "Bob", color: "green" as const };

describe("initials", () => {
  it("uses the first and last word for a long name", () => {
    expect(initials("Maria Silva")).toBe("MS");
    expect(initials("Ana Maria da Silva")).toBe("AS");
  });
  it("uses one initial for a one-word name", () => {
    expect(initials("Bob")).toBe("B");
    expect(initials("  ")).toBe("?");
  });
});

describe("memberColor", () => {
  it("is stable and in the palette", () => {
    for (let id = 1; id < 40; id++) {
      expect(memberColor(id)).toBe(memberColor(id));
      expect(EVENT_COLORS).toContain(memberColor(id));
    }
    expect(memberColor(8)).toBe(EVENT_COLORS[0]);
    expect(memberColor(9)).toBe(EVENT_COLORS[1]);
  });
  it("maps a color to its css variable", () => {
    expect(eventColorVar("teal")).toBe("var(--ev-teal)");
  });
});

describe("Avatar", () => {
  it("shows the initials on the person's color", () => {
    render(<Avatar person={maria} labelled />);
    const face = screen.getByRole("img", { name: "Maria Silva" });
    expect(face).toHaveTextContent("MS");
    expect(face.style.getPropertyValue("--avatar-color")).toBe("var(--ev-red)");
  });
  it("is decorative unless labelled", () => {
    render(<Avatar person={bob} />);
    expect(screen.queryByRole("img")).toBeNull();
  });
  it("is muted when muted", () => {
    render(<Avatar person={bob} muted labelled />);
    expect(screen.getByRole("img", { name: "Bob" })).toHaveClass("avatar--muted");
  });
});

describe("AvatarGroup", () => {
  const people = [1, 2, 3, 4, 5, 6].map((id) => ({ id, name: `Person ${id}`, color: "blue" as const }));
  it("shows +N beyond max", () => {
    render(<AvatarGroup people={people} everyone={false} max={4} />);
    expect(screen.getAllByRole("img", { name: /^Person [1-4]$/ })).toHaveLength(4);
    expect(screen.getByText("+2")).toBeInTheDocument();
  });
  it("shows the people icon for everyone", () => {
    render(<AvatarGroup people={[]} everyone />);
    expect(screen.getByRole("img", { name: "Tout le monde" })).toBeInTheDocument();
  });
});
