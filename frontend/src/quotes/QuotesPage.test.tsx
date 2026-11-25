import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockApi, renderWithProviders, resetLanguage, useEnglish } from "../testUtils";
import { summary } from "./fixtures";
import { QuotesPage } from "./QuotesPage";

const ROWS = [
  summary({ id: 5, reference: "D-0005", name: "Maria Silva", city: "Québec", overdue: true }),
  summary({ id: 6, reference: "D-0006", name: "São Paulo Cleaning", kind: "commercial", city: "Lévis", status: "customer_replied", messages: 2 }),
];

beforeEach(async () => { await useEnglish(); });
afterEach(async () => { vi.unstubAllGlobals(); await resetLanguage(); });

function api() {
  return mockApi({
    "GET /api/quotes": ({ url }: { url: URL }) => {
      const status = url.searchParams.get("status") ?? "all";
      const quotes = status === "all" ? ROWS : ROWS.filter((r) => r.status === status);
      return { quotes, counts: { new: 1, customer_replied: 1 } };
    },
  });
}

describe("QuotesPage", () => {
  it("lists the quotes with reference, name, type, place, deadline and message count", async () => {
    api();
    renderWithProviders(<QuotesPage />);
    const maria = await screen.findByRole("link", { name: /Maria Silva/ });
    expect(maria).toHaveAttribute("href", "/quotes/5");
    expect(maria).toHaveTextContent("D-0005");
    expect(maria).toHaveTextContent("Airbnb");
    expect(maria).toHaveTextContent("Québec");
    expect(maria).toHaveTextContent("Overdue");
  });

  it("asks the server for the tab that was picked", async () => {
    const { calls } = api();
    renderWithProviders(<QuotesPage />);
    await screen.findByRole("link", { name: /Maria Silva/ });
    fireEvent.click(screen.getByRole("radio", { name: "Customer replied" }));
    await waitFor(() => expect(calls.some((c) => c.query.includes("status=customer_replied"))).toBe(true));
    expect(await screen.findByRole("link", { name: /São Paulo Cleaning/ })).toBeInTheDocument();
    expect(screen.getByText("2 messages")).toBeInTheDocument();
  });

  it("searches name, address, phone and reference ignoring case and accents", async () => {
    api();
    renderWithProviders(<QuotesPage />);
    await screen.findByRole("link", { name: /Maria Silva/ });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search quotes" }), { target: { value: "sao PAULO" } });
    expect(await screen.findByRole("link", { name: /São Paulo Cleaning/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Maria Silva/ })).toBeNull();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search quotes" }), { target: { value: "levis" } });
    expect(await screen.findByRole("link", { name: /São Paulo Cleaning/ })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search quotes" }), { target: { value: "zzz" } });
    expect(await screen.findByText("No quote matches your search.")).toBeInTheDocument();
  });

  it("says so when there is nothing in the tab", async () => {
    mockApi({ "GET /api/quotes": { quotes: [], counts: { new: 0, customer_replied: 0 } } });
    renderWithProviders(<QuotesPage />);
    expect(await screen.findByText("No quotes here yet.")).toBeInTheDocument();
  });
});
