import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClientPage } from "../clients/ClientPage";
import { mockApi, renderWithProviders, resetLanguage, testUser, useEnglish } from "../testUtils";
import { BillDialog } from "./BillDialog";
import type { BillableOccurrence } from "./types";

const admin = { session: { user: { ...testUser, role: "admin" as const } } };

const occ = (over: Partial<BillableOccurrence>): BillableOccurrence => ({
  event_id: 3, occurrence_date: "2026-11-06", date: "2026-11-06", title: "Cleaning", property_id: 11, property_name: "Beach house", price: "120.00",
  description: "Entretien ménager - Beach house - 06/11/2026", checked_out: true, ...over,
});
const OCCURRENCES = [occ({}), occ({ event_id: 4, occurrence_date: "2026-11-13", date: "2026-11-14", price: null, property_id: null, property_name: null, description: "Entretien ménager - Vitres - 14/11/2026" })];
const created = { invoice: { id: 9, number: 9, reference: "009" } };

beforeEach(async () => { await useEnglish(); });
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); await resetLanguage(); });

function open(handlers: Record<string, unknown> = {}) {
  const onCreated = vi.fn();
  const api = mockApi({ "GET /api/clients/5/billable": { occurrences: OCCURRENCES }, ...handlers });
  renderWithProviders(<BillDialog clientId={5} onClose={() => undefined} onCreated={onCreated} />, admin);
  return { api, onCreated };
}
const create = () => screen.getByRole("button", { name: "Create the invoice" });

describe("BillDialog", () => {
  it("lists the occurrences with the property price, and blocks Create until every ticked line has an amount", async () => {
    open();
    const amounts = await screen.findAllByLabelText("Amount");
    expect(amounts).toHaveLength(2);
    expect(amounts[0]).toHaveValue("120.00");
    expect(amounts[1]).toHaveValue("");
    expect(screen.getAllByLabelText("Description")[0]).toHaveValue("Entretien ménager - Beach house - 06/11/2026");
    expect(create()).toBeDisabled();
    fireEvent.change(amounts[1], { target: { value: "95,5" } });
    expect(create()).toBeEnabled();
    fireEvent.change(amounts[1], { target: { value: "9x" } });
    expect(create()).toBeDisabled();
  });

  it("takes an unticked line out of the total", async () => {
    open();
    const amounts = await screen.findAllByLabelText("Amount");
    fireEvent.change(amounts[1], { target: { value: "80" } });
    expect(screen.getByTestId("bill-total")).toHaveTextContent("200.00");
    fireEvent.click(screen.getByRole("checkbox", { name: /Include .*Nov 14/ }));
    expect(screen.getByTestId("bill-total")).toHaveTextContent("120.00");
    expect(create()).toBeEnabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Include .*Nov 6/ }));
    expect(create()).toBeDisabled(); // nothing is ticked
  });

  it("posts the ticked lines by their original date, the manual line, the extra and the date", async () => {
    const { api, onCreated } = open({ "POST /api/invoices": created });
    const amounts = await screen.findAllByLabelText("Amount");
    fireEvent.change(amounts[1], { target: { value: "120" } });
    fireEvent.click(screen.getByRole("button", { name: "Add a line" }));
    const descriptions = screen.getAllByLabelText("Description");
    fireEvent.change(descriptions[2], { target: { value: "Vitres" } });
    fireEvent.change(screen.getAllByLabelText("Amount")[2], { target: { value: "40" } });
    fireEvent.change(screen.getByLabelText("Extra costs"), { target: { value: "10" } });
    expect(screen.getByTestId("bill-total")).toHaveTextContent("290.00");
    fireEvent.click(create());
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST")).toBe(true));
    const body = api.calls.find((c) => c.method === "POST")!.body as { client_id: number; issued_on: string; extra: string; lines: unknown[] };
    expect(body).toMatchObject({ client_id: 5, extra: "10.00" });
    expect(body.issued_on).toMatch(/^\d{4}-\d\d-\d\d$/);
    expect(body.lines).toEqual([
      { event_id: 3, occurrence_date: "2026-11-06", description: "Entretien ménager - Beach house - 06/11/2026", amount: "120.00" },
      { event_id: 4, occurrence_date: "2026-11-13", description: "Entretien ménager - Vitres - 14/11/2026", amount: "120.00" },
      { description: "Vitres", amount: "40.00" },
    ]);
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(9));
  });

  it("marks a cleaning that has no check-out, and keeps it ticked and billable", async () => {
    const { api } = open({
      "GET /api/clients/5/billable": { occurrences: [
        occ({}),
        occ({ event_id: 4, occurrence_date: "2026-11-13", date: "2026-11-14", checked_out: false, description: "Entretien ménager - Beach house - 14/11/2026" }),
        // an item without a property has no check-in at all: nothing to warn about
        occ({ event_id: 5, occurrence_date: "2026-11-16", date: "2026-11-16", checked_out: false, property_id: null, property_name: null, price: "50.00", description: "Entretien ménager - Vitres - 16/11/2026" }),
      ] },
      "POST /api/invoices": created,
    });
    await screen.findAllByLabelText("Amount");
    expect(screen.getAllByText("No check-out")).toHaveLength(1);
    const unchecked = screen.getByRole("checkbox", { name: /Include .*Nov 14/ });
    expect(unchecked.closest("li")).toHaveTextContent("No check-out");
    expect(screen.getByRole("checkbox", { name: /Include .*Nov 6/ }).closest("li")).not.toHaveTextContent("No check-out");
    expect(screen.getByRole("checkbox", { name: /Include .*Nov 16/ }).closest("li")).not.toHaveTextContent("No check-out");
    expect(unchecked).toBeChecked();
    expect(unchecked).toBeEnabled();
    expect(screen.getByTestId("bill-total")).toHaveTextContent("290.00");
    fireEvent.click(create());
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST")).toBe(true));
    const lines = (api.calls.find((c) => c.method === "POST")!.body as { lines: { event_id?: number }[] }).lines;
    expect(lines.map((l) => l.event_id)).toEqual([3, 4, 5]);
  });

  it("asks again for the occurrences when the period changes", async () => {
    const { api } = open();
    await screen.findAllByLabelText("Amount");
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-01" } });
    await waitFor(() => expect(api.calls.filter((c) => c.method === "GET" && c.query.includes("from=2026-10-01"))).toHaveLength(1));
  });

  it("says when there is nothing to bill, and still allows manual lines", async () => {
    mockApi({ "GET /api/clients/5/billable": { occurrences: [] } });
    renderWithProviders(<BillDialog clientId={5} onClose={() => undefined} onCreated={() => undefined} />, admin);
    expect(await screen.findByText("No finished cleaning to bill in this period.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add a line" }));
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Après-construction" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "850" } });
    expect(create()).toBeEnabled();
  });

  it("explains a cleaning that was billed meanwhile and asks for the list again", async () => {
    const { api } = open({ "POST /api/invoices": { ok: false, status: 409, json: async () => ({ error: "already_billed" }) } });
    const amounts = await screen.findAllByLabelText("Amount");
    fireEvent.change(amounts[1], { target: { value: "120" } });
    fireEvent.click(create());
    expect(await screen.findByRole("alert")).toHaveTextContent("already on another invoice");
    await waitFor(() => expect(api.calls.filter((c) => c.method === "GET" && c.path === "/api/clients/5/billable").length).toBeGreaterThan(1));
  });
});

describe("the invoices of a client", () => {
  const client = {
    id: 5, name: "Chantal Roy", kinds: ["airbnb"], contact_name: null, email: null, phone: null, address: null, city: null, notes: null, created_at: "", updated_at: "",
    properties: [], tasks: [], events: [], documents: [], quotes: [],
    invoices: [{ id: 9, reference: "009", issued_on: "2026-11-27", total: "205.00", status: "unpaid" }, { id: 7, reference: "007", issued_on: "2026-10-30", total: "99.00", status: "paid" }],
  };

  it("lists them on the client page and opens the bill dialog from there", async () => {
    mockApi({ "GET /api/clients/5": { client }, "GET /api/clients/5/billable": { occurrences: [] } });
    renderWithProviders(<ClientPage id={5} />, admin);
    fireEvent.click(await screen.findByRole("radio", { name: /Invoices/ }));
    const first = screen.getByRole("link", { name: /009/ });
    expect(first).toHaveAttribute("href", "/invoices/9");
    expect(first.closest("li")).toHaveTextContent("205.00");
    expect(first.closest("li")).toHaveTextContent("Unpaid");
    expect(screen.getByRole("link", { name: /007/ }).closest("li")).toHaveTextContent("Paid");
    fireEvent.click(screen.getByRole("button", { name: "Bill" }));
    expect(await within(await screen.findByRole("dialog")).findByText("No finished cleaning to bill in this period.")).toBeInTheDocument();
  });

  it("does not show invoices to Staff", async () => {
    const { invoices: _i, notes: _n, ...view } = client;
    mockApi({ "GET /api/clients/5": { client: { ...view, tasks: undefined, documents: undefined, quotes: undefined } } });
    renderWithProviders(<ClientPage id={5} />, { session: { user: testUser } });
    await screen.findByRole("radio", { name: /Properties/ });
    expect(screen.queryByRole("radio", { name: /Invoices/ })).toBeNull();
  });
});
