import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import i18n from "./i18n";
import en from "./locales/en.json";
import frCA from "./locales/fr-CA.json";
import ptBR from "./locales/pt-BR.json";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
});
afterEach(async () => {
  cleanup();
  await act(() => i18n.changeLanguage("fr-CA"));
});

describe("App", () => {
  it("renders the French title by default", async () => {
    render(<App />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("En construction");
    await waitFor(() => expect(screen.getByText(frCA.apiOk)).toBeInTheDocument());
  });

  it.each([
    ["en", "Under Construction"],
    ["pt-BR", "Em construção"],
  ])("renders %s after changeLanguage", async (lng, title) => {
    await act(() => i18n.changeLanguage(lng));
    render(<App />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(title);
    expect(document.title).toBe(title);
  });

  it("shows apiDown when the health call rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    render(<App />);
    await waitFor(() => expect(screen.getByText(frCA.apiDown)).toBeInTheDocument());
  });

  it("shows apiDown when the health call is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    render(<App />);
    await waitFor(() => expect(screen.getByText(frCA.apiDown)).toBeInTheDocument());
  });

  it("all locale files define the same keys", () => {
    const keys = (o: object) => Object.keys(o).sort();
    expect(keys(en)).toEqual(keys(frCA));
    expect(keys(ptBR)).toEqual(keys(frCA));
  });
});
