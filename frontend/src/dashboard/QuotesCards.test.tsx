import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockApi, renderWithProviders, resetLanguage, useEnglish } from "../testUtils";
import { summary } from "../quotes/fixtures";
import type { QuoteSummary } from "../quotes/types";
import { QuotesLatestCard } from "./QuotesLatestCard";
import { QuotesSummaryCard } from "./QuotesSummaryCard";

beforeEach(async () => { await useEnglish(); });
afterEach(async () => { vi.unstubAllGlobals(); await resetLanguage(); });

const api = (quotes: QuoteSummary[], counts = { new: 0, customer_replied: 0, replied: 0 }) => mockApi({ "GET /api/quotes": { quotes, counts } });

describe("QuotesSummaryCard", () => {
  it("shows what needs a reply, what waits on the customer and what is overdue, each opening its tab", async () => {
    api([summary({ id: 1, overdue: true }), summary({ id: 2 })], { new: 2, customer_replied: 1, replied: 4 });
    const open = vi.fn();
    renderWithProviders(<QuotesSummaryCard onOpenQuotes={open} />);
    const need = await screen.findByRole("button", { name: /Needs reply/ });
    expect(need).toHaveTextContent("3");
    expect(screen.getByRole("button", { name: /Waiting on customer/ })).toHaveTextContent("4");
    const late = screen.getByRole("button", { name: /Overdue/ });
    expect(late).toHaveTextContent("1");
    expect(late).toHaveClass("dash__stat--late");
    fireEvent.click(need);
    fireEvent.click(screen.getByRole("button", { name: /Waiting on customer/ }));
    fireEvent.click(late);
    expect(open.mock.calls).toEqual([["new"], ["replied"], ["new"]]);
  });

  it("is not red when nothing is overdue", async () => {
    api([summary()], { new: 1, customer_replied: 0, replied: 0 });
    renderWithProviders(<QuotesSummaryCard onOpenQuotes={vi.fn()} />);
    expect(await screen.findByRole("button", { name: /Overdue/ })).not.toHaveClass("dash__stat--late");
  });

  it("celebrates when nobody is waiting", async () => {
    api([], { new: 0, customer_replied: 0, replied: 0 });
    const { container } = renderWithProviders(<QuotesSummaryCard onOpenQuotes={vi.fn()} />);
    expect(await screen.findByText("Inbox zero!")).toBeInTheDocument();
    expect(screen.getByText("Nobody is waiting on you. Go grab a coffee.")).toBeInTheDocument();
    expect(container.querySelector("svg[data-art='quotes']")).toBeInTheDocument();
  });
});

describe("QuotesLatestCard", () => {
  const seven = Array.from({ length: 7 }, (_, i) => summary({ id: 10 + i, reference: `D-00${10 + i}`, name: `Client ${i}`, overdue: i === 0 }));

  it("lists the five newest with a status and the overdue tag, and opens a quote", async () => {
    api(seven);
    const open = vi.fn();
    renderWithProviders(<QuotesLatestCard onOpenQuote={open} onOpenQuotes={vi.fn()} locale="en" />);
    const first = await screen.findByRole("link", { name: /Client 0/ });
    expect(first).toHaveTextContent("D-0010");
    expect(first).toHaveTextContent("Québec");
    expect(first).toHaveTextContent("New");
    expect(first).toHaveTextContent("Overdue");
    expect(screen.getAllByRole("link", { name: /Client/ })).toHaveLength(5);
    fireEvent.click(first);
    expect(open).toHaveBeenCalledWith(10);
  });

  it("shows a friendly empty state", async () => {
    api([]);
    const { container } = renderWithProviders(<QuotesLatestCard onOpenQuote={vi.fn()} onOpenQuotes={vi.fn()} locale="en" />);
    expect(await screen.findByText("No quote requests yet.")).toBeInTheDocument();
    expect(screen.getByText("The next customer is on the way.")).toBeInTheDocument();
    expect(container.querySelector("svg[data-art='quotes']")).toBeInTheDocument();
  });
});
