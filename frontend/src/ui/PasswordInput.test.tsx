import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import i18n from "../i18n";
import { PasswordInput } from "./PasswordInput";

function Harness() {
  const [value, setValue] = useState("s3cret!");
  return (
    <label>
      Password
      <PasswordInput label="Password" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="current-password" />
    </label>
  );
}

beforeEach(async () => { await act(() => i18n.changeLanguage("en")); });
afterEach(async () => { cleanup(); await act(() => i18n.changeLanguage("fr-CA")); });

describe("PasswordInput", () => {
  it("hides the password until the eye is pressed, then hides it again", () => {
    render(<Harness />);
    const input = screen.getByLabelText("Password") as HTMLInputElement;
    expect(input.type).toBe("password");
    const eye = screen.getByRole("button", { name: "Show password" });
    expect(eye).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(eye);
    expect(input.type).toBe("text");
    expect(input.value).toBe("s3cret!");
    const hide = screen.getByRole("button", { name: "Hide password" });
    expect(hide).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(hide);
    expect(input.type).toBe("password");
  });

  it("keeps the field's own name (the eye does not become part of it) and never submits the form", () => {
    let submitted = false;
    render(<form onSubmit={(e) => { e.preventDefault(); submitted = true; }}><Harness /></form>);
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(submitted).toBe(false);
    expect(screen.getByLabelText("Password")).toHaveAccessibleName("Password");
  });

  it("is in French by default", async () => {
    await act(() => i18n.changeLanguage("fr-CA"));
    render(<Harness />);
    expect(screen.getByRole("button", { name: "Afficher le mot de passe" })).toBeInTheDocument();
  });
});
