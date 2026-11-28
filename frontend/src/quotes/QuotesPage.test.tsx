import { fireEvent, screen, waitFor, within } from "@testing-library/react";
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

  it("keeps the search box behind the magnifier button in the header, like Clients", async () => {
    api();
    renderWithProviders(<QuotesPage />);
    await screen.findByRole("link", { name: /Maria Silva/ });
    expect(screen.queryByRole("searchbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Search quotes" }));
    expect(screen.getByRole("searchbox", { name: "Search quotes" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search quotes" }), { target: { value: "sao" } });
    fireEvent.click(screen.getByRole("button", { name: "Search quotes" })); // closing it clears the search
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(await screen.findByRole("link", { name: /Maria Silva/ })).toBeInTheDocument();
  });

  it("searches name, address, phone and reference ignoring case and accents", async () => {
    api();
    renderWithProviders(<QuotesPage />);
    await screen.findByRole("link", { name: /Maria Silva/ });
    fireEvent.click(screen.getByRole("button", { name: "Search quotes" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search quotes" }), { target: { value: "sao PAULO" } });
    expect(await screen.findByRole("link", { name: /São Paulo Cleaning/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Maria Silva/ })).toBeNull();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search quotes" }), { target: { value: "levis" } });
    expect(await screen.findByRole("link", { name: /São Paulo Cleaning/ })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search quotes" }), { target: { value: "zzz" } });
    expect(await screen.findByText("No quote matches your search.")).toBeInTheDocument();
  });

  it("shows a picture and a fun line when there are no requests at all", async () => {
    mockApi({ "GET /api/quotes": { quotes: [], counts: { new: 0, customer_replied: 0, replied: 0 } } });
    const { container } = renderWithProviders(<QuotesPage />, { route: "/quotes?tab=all" });
    expect(await screen.findByText("No quote requests yet.")).toBeInTheDocument();
    expect(screen.getByText("The mailbox is quiet. Enjoy the calm!")).toBeInTheDocument();
    expect(container.querySelector("svg[data-art='quotes']")).toBeInTheDocument();
  });

  it("says all is caught up, not 'no requests yet', when only the New tab is empty", async () => {
    mockApi({ "GET /api/quotes": { quotes: [], counts: { new: 0, customer_replied: 0, replied: 3 } } });
    const { container } = renderWithProviders(<QuotesPage />);
    expect(await screen.findByText("Nothing new. You're all caught up!")).toBeInTheDocument();
    expect(screen.queryByText("No quote requests yet.")).toBeNull();
    expect(container.querySelector("svg[data-art='quotes']")).toBeInTheDocument();
  });

  it("says so plainly, without a picture, when another tab is empty", async () => {
    mockApi({ "GET /api/quotes": { quotes: [], counts: { new: 0, customer_replied: 0, replied: 0 } } });
    const { container } = renderWithProviders(<QuotesPage />, { route: "/quotes?tab=replied" });
    expect(await screen.findByText("No quotes here yet.")).toBeInTheDocument();
    expect(container.querySelector("svg[data-art='quotes']")).toBeNull();
  });

  it("opens on the tab named in the address, and on New when it is unknown", async () => {
    api();
    const first = renderWithProviders(<QuotesPage />, { route: "/quotes?tab=replied" });
    expect(await screen.findByRole("radio", { name: "Replied" })).toBeChecked();
    first.unmount();
    renderWithProviders(<QuotesPage />, { route: "/quotes?tab=bogus" });
    expect(await screen.findByRole("radio", { name: "New" })).toBeChecked();
  });

  it("lets an administrator enter a quote taken by phone", async () => {
    const calls = mockApi({
      "GET /api/quotes": { quotes: [], counts: { new: 0, customer_replied: 0 } },
      "GET /api/clients": { clients: [] },
      "POST /api/quotes": { quote: { ...summary({ id: 9 }), details: {}, conversation: [], photos: [] } },
    });
    renderWithProviders(<QuotesPage />, { session: { user: { id: 1, username: "a", name: "A", email: "a@x.ca", role: "admin", locale: "en" } } });
    fireEvent.click(await screen.findByRole("button", { name: "New quote" }));
    const dialog = within(await screen.findByRole("dialog"));
    fireEvent.click(dialog.getByRole("button", { name: "Save" }));
    expect(await dialog.findByText("Enter the name.")).toBeInTheDocument(); // name and phone are needed
    expect(calls.calls.some((c) => c.method === "POST")).toBe(false);
    fireEvent.change(dialog.getByLabelText("Name"), { target: { value: "  Chantal Roy " } });
    fireEvent.change(dialog.getByLabelText("Phone"), { target: { value: "418-555-0101" } });
    fireEvent.change(dialog.getByLabelText("City"), { target: { value: "Québec" } });
    fireEvent.change(dialog.getByLabelText("What the customer asked for"), { target: { value: "Weekly turnover" } });
    fireEvent.click(dialog.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.calls.find((c) => c.method === "POST")!.body).toMatchObject({ name: "Chantal Roy", phone: "418-555-0101", email: null, kind: "airbnb", city: "Québec", message: "Weekly turnover", client_id: null, locale: "fr-CA" });
  });
});
