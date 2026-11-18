import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import "./i18n";
import frCA from "./locales/fr-CA.json";

vi.mock("./welcomeContent", () => ({ welcomeBlocks: [{ titleKey: "adminTitle", bodyKey: "adminSearch" }] }));

import WelcomePage from "./WelcomePage";

afterEach(cleanup);

describe("welcome content blocks", () => {
  it("renders every block from welcomeContent as a heading and a paragraph", () => {
    render(<WelcomePage user={{ id: 1, username: "alice", name: null, email: "a@example.com", role: "user", locale: "fr-CA" }} mfaEnabled recoveryCodesLeft={null} />);
    expect(screen.getByRole("heading", { level: 2, name: frCA.adminTitle })).toBeInTheDocument();
    expect(screen.getByText(frCA.adminSearch)).toBeInTheDocument();
  });
});
