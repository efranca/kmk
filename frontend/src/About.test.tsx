import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AboutPage from "./AboutPage";
import AboutSection from "./AboutSection";
import i18n from "./i18n";
import en from "./locales/en.json";
import SettingsPage from "./SettingsPage";
import { renderWithProviders } from "./testUtils";

const res = (status: number, body: unknown = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const server = { version: "0.2.58", commit: "bbbbbbb", built_at: "2026-11-24T10:00:00Z" };

function mockVersion(reply: () => unknown) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url === "/api/version") return reply();
    throw new Error(`unexpected ${url}`);
  }));
}

beforeEach(async () => {
  await act(() => i18n.changeLanguage("en"));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("About", () => {
  it("shows the app's own version and the server's", async () => {
    mockVersion(() => res(200, server));
    renderWithProviders(<AboutSection />);
    expect(screen.getByText(__APP_VERSION__)).toBeInTheDocument();
    expect(await screen.findByText("0.2.58")).toBeInTheDocument();
    expect(screen.getByText("bbbbbbb")).toBeInTheDocument();
  });

  it("says the server is unknown when the call fails", async () => {
    mockVersion(() => res(500));
    renderWithProviders(<AboutSection />);
    await waitFor(() => expect(screen.getAllByText(en.aboutUnknown).length).toBeGreaterThan(0));
    expect(screen.queryByText(en.aboutMismatch)).toBeNull();
  });

  it("warns when the app and the server come from different commits", async () => {
    vi.stubGlobal("__BUILD_COMMIT__", "aaaaaaa");
    mockVersion(() => res(200, server));
    renderWithProviders(<AboutSection />);
    expect(await screen.findByText(en.aboutMismatch)).toBeInTheDocument();
  });

  it("does not warn when the server's commit is unknown", async () => {
    vi.stubGlobal("__BUILD_COMMIT__", "aaaaaaa");
    mockVersion(() => res(200, { ...server, commit: "" }));
    renderWithProviders(<AboutSection />);
    await screen.findByText("0.2.58");
    expect(screen.queryByText(en.aboutMismatch)).toBeNull();
  });

  it("does not warn when the commits match", async () => {
    vi.stubGlobal("__BUILD_COMMIT__", "bbbbbbb");
    mockVersion(() => res(200, server));
    renderWithProviders(<AboutSection />);
    await screen.findByText("0.2.58");
    expect(screen.queryByText(en.aboutMismatch)).toBeNull();
  });

  it("has a card for the app and one for the server", async () => {
    mockVersion(() => res(200, server));
    renderWithProviders(<AboutPage />);
    expect(screen.getByRole("heading", { level: 1, name: en.navAbout })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: en.aboutApp })).toHaveTextContent(__APP_VERSION__);
    expect(await within(screen.getByRole("region", { name: en.aboutServer })).findByText("0.2.58")).toBeInTheDocument();
  });

  it("is no longer on the Settings page", () => {
    mockVersion(() => res(200, server));
    renderWithProviders(<SettingsPage onLanguageChanged={vi.fn()} />);
    expect(screen.queryByRole("region", { name: en.aboutApp })).toBeNull();
    expect(screen.queryByText(en.aboutVersion)).toBeNull();
  });
});
