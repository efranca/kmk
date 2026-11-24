import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useRoute } from "./route";
import { renderWithProviders } from "./testUtils";

function Probe() {
  const { path, navigate } = useRoute();
  return (
    <div>
      <p data-testid="path">{path}</p>
      <button onClick={() => navigate("/schedule")}>go</button>
    </div>
  );
}

describe("useRoute", () => {
  it("reads the current path", () => {
    renderWithProviders(<Probe />, { route: "/account" });
    expect(screen.getByTestId("path")).toHaveTextContent("/account");
  });

  it("navigates without reloading", () => {
    renderWithProviders(<Probe />, { route: "/" });
    fireEvent.click(screen.getByRole("button", { name: "go" }));
    expect(screen.getByTestId("path")).toHaveTextContent("/schedule");
  });
});
