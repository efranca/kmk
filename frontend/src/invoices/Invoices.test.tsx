import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockApi, renderWithProviders, resetLanguage, testUser, useEnglish } from "../testUtils";
import { InvoicePage } from "./InvoicePage";
import { InvoicesPage } from "./InvoicesPage";
import type { Invoice, InvoiceSummary } from "./types";

const admin = { session: { user: { ...testUser, role: "admin" as const } } };

const summary = (over: Partial<InvoiceSummary> = {}): InvoiceSummary => ({
  id: 7, number: 7, reference: "007", client_id: 5, bill_name: "Ducarme / Mike", bill_address: "640 St Jean", bill_city: "Québec", bill_phone: "418 353-7465", bill_email: "mike@example.com",
  issued_on: "2026-11-27", status: "unpaid", paid_on: null, subtotal: "195.00", tax: "0.00", extra: "10.00", total: "205.00", sent_at: null, cancelled_at: null, document_id: 31, ...over,
});
const invoice = (over: Partial<Invoice> = {}): Invoice => ({
  ...summary(), lines: [
    { description: "Entretien ménager - Beach house - 06/11/2026", amount: "120.00", event_id: 3, occurrence_date: "2026-11-06" },
    { description: "Vitres", amount: "75.00", event_id: null, occurrence_date: null },
  ], ...over,
});

beforeEach(async () => { await useEnglish(); });
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); await resetLanguage(); });

describe("InvoicesPage", () => {
  const rows = [summary(), summary({ id: 6, number: 6, reference: "006", bill_name: "Marc Dion", status: "paid", paid_on: "2026-11-20", total: "99.00" })];
  function list() {
    return mockApi({
      "GET /api/invoices": ({ url }: { url: URL }) => {
        const status = url.searchParams.get("status");
        return { invoices: status ? rows.filter((r) => r.status === status) : rows, unpaid_total: "205.00" };
      },
    });
  }

  it("lists the invoices with number, client, date, total and status, and the unpaid total on top", async () => {
    list();
    renderWithProviders(<InvoicesPage />, admin);
    const row = await screen.findByRole("link", { name: /Ducarme \/ Mike/ });
    expect(row).toHaveAttribute("href", "/invoices/7");
    expect(row).toHaveTextContent("007");
    expect(row).toHaveTextContent("205.00");
    expect(row).toHaveTextContent("Unpaid");
    expect(screen.getByRole("link", { name: /Marc Dion/ })).toHaveTextContent("Paid");
    expect(screen.getByText(/Unpaid: .*205\.00/)).toBeInTheDocument();
  });

  it("asks the server for the tab that was picked", async () => {
    const api = list();
    renderWithProviders(<InvoicesPage />, admin);
    await screen.findByRole("link", { name: /Ducarme/ });
    fireEvent.click(screen.getByRole("radio", { name: "Paid" }));
    expect(await screen.findByRole("link", { name: /Marc Dion/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Ducarme/ })).toBeNull();
    expect(api.calls.some((c) => c.query.includes("status=paid"))).toBe(true);
  });

  it("says so when there is nothing to show", async () => {
    mockApi({ "GET /api/invoices": { invoices: [], unpaid_total: "0.00" } });
    renderWithProviders(<InvoicesPage />, admin);
    expect(await screen.findByText("No invoices here yet.")).toBeInTheDocument();
  });
});

describe("InvoicePage", () => {
  function page(inv: Invoice, extra: Record<string, unknown> = {}) {
    return mockApi({ "GET /api/invoices/7": { invoice: inv }, ...extra });
  }

  it("shows the billed-to block, the lines and the totals", async () => {
    page(invoice());
    renderWithProviders(<InvoicePage id={7} />, admin);
    expect(await screen.findByRole("heading", { level: 1, name: /Invoice 007/ })).toBeInTheDocument();
    expect(screen.getByText("Ducarme / Mike")).toBeInTheDocument();
    expect(screen.getByText("640 St Jean")).toBeInTheDocument();
    expect(screen.getByText("Vitres")).toBeInTheDocument();
    expect(screen.getByText(/Beach house - 06\/11\/2026/)).toBeInTheDocument();
    expect(screen.getByText(/205\.00/, { selector: ".invoice-totals__total *, .invoice-totals__total" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download PDF" })).toHaveAttribute("href", "/api/invoices/7/pdf");
    expect(screen.getByRole("link", { name: /Open client: Ducarme/ })).toHaveAttribute("href", "/clients/5");
  });

  it("marks it as paid on the date picked, today by default", async () => {
    const api = page(invoice(), { "POST /api/invoices/7/payment": { invoice: invoice({ status: "paid", paid_on: "2026-11-27" }) } });
    renderWithProviders(<InvoicePage id={7} />, admin);
    fireEvent.click(await screen.findByRole("button", { name: "Mark as paid" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByLabelText("Payment date")).toHaveValue(new Date().toLocaleDateString("sv-SE", { timeZone: "America/Toronto" }));
    fireEvent.change(dialog.getByLabelText("Payment date"), { target: { value: "2026-11-20" } });
    fireEvent.click(dialog.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST")).toBe(true));
    expect(api.calls.find((c) => c.method === "POST")).toMatchObject({ path: "/api/invoices/7/payment", body: { paid_on: "2026-11-20" } });
  });

  it("can undo a payment", async () => {
    const api = page(invoice({ status: "paid", paid_on: "2026-11-20" }), { "DELETE /api/invoices/7/payment": { invoice: invoice() } });
    renderWithProviders(<InvoicePage id={7} />, admin);
    expect(await screen.findByText(/Paid on/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark as paid" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Mark as unpaid" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "DELETE")).toBe(true));
  });

  it("asks before cancelling, and says the number is kept", async () => {
    const api = page(invoice(), { "POST /api/invoices/7/cancel": { invoice: invoice({ status: "cancelled" }) } });
    renderWithProviders(<InvoicePage id={7} />, admin);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel invoice" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText(/number is kept/)).toBeInTheDocument();
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
    fireEvent.click(dialog.getByRole("button", { name: "Yes, cancel the invoice" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST" && c.path === "/api/invoices/7/cancel")).toBe(true));
  });

  it("offers only the download once cancelled", async () => {
    page(invoice({ status: "cancelled", cancelled_at: "2026-11-28T10:00:00Z" }));
    renderWithProviders(<InvoicePage id={7} />, admin);
    expect(await screen.findByRole("link", { name: "Download PDF" })).toBeInTheDocument();
    for (const name of ["Mark as paid", "Mark as unpaid", "Send by email", "Cancel invoice"]) expect(screen.queryByRole("button", { name })).toBeNull();
  });

  it("sends it to the client's address, which can be changed, and shows when it went", async () => {
    const api = page(invoice(), { "POST /api/invoices/7/send": { invoice: invoice({ sent_at: "2026-11-27T15:00:00Z" }) } });
    renderWithProviders(<InvoicePage id={7} />, admin);
    fireEvent.click(await screen.findByRole("button", { name: "Send by email" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByLabelText("Send to")).toHaveValue("mike@example.com");
    fireEvent.change(dialog.getByLabelText("Send to"), { target: { value: "accounts@example.com" } });
    fireEvent.click(dialog.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST")).toBe(true));
    expect(api.calls.find((c) => c.method === "POST")).toMatchObject({ path: "/api/invoices/7/send", body: { to: "accounts@example.com" } });
  });

  it("shows when it was sent", async () => {
    page(invoice({ sent_at: "2026-11-27T15:00:00Z" }));
    renderWithProviders(<InvoicePage id={7} />, admin);
    expect(await screen.findByText(/Sent on/)).toBeInTheDocument();
  });

  it("shows a failed send in the dialog and keeps it open", async () => {
    page(invoice(), { "POST /api/invoices/7/send": { ok: false, status: 502, json: async () => ({ error: "email_failed" }) } });
    renderWithProviders(<InvoicePage id={7} />, admin);
    fireEvent.click(await screen.findByRole("button", { name: "Send by email" }));
    const dialog = within(await screen.findByRole("dialog"));
    fireEvent.click(dialog.getByRole("button", { name: "Send" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent("The email could not be sent");
  });
});
