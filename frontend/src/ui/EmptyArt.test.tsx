import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EmptyArt } from "./EmptyArt";

describe("EmptyArt", () => {
  it("shows a picture (hidden from screen readers), the message, the fun line and the action", () => {
    const { container } = render(
      <EmptyArt art="documents" title="No documents yet." hint="Your library is waiting for its first page!">
        <button type="button">Add the first document</button>
      </EmptyArt>,
    );
    const picture = container.querySelector("svg[data-art='documents']")!;
    expect(picture).toBeInTheDocument();
    expect(picture).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("No documents yet.")).toBeInTheDocument();
    expect(screen.getByText("Your library is waiting for its first page!")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add the first document" })).toBeInTheDocument();
  });

  it("has a picture for documents, tasks and events, and a smaller version for cards", () => {
    for (const art of ["documents", "tasks", "events"] as const) {
      const { container, unmount } = render(<EmptyArt art={art} title="x" compact />);
      expect(container.querySelector(`svg[data-art='${art}']`)).toBeInTheDocument();
      expect(container.querySelector(".empty-art--compact")).toBeInTheDocument();
      unmount();
    }
  });

  it("works without a fun line", () => {
    render(<EmptyArt art="tasks" title="Nothing here." />);
    expect(screen.getByText("Nothing here.")).toBeInTheDocument();
  });
});
