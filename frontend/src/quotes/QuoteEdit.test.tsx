import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { testUser, mockApi, renderWithProviders, resetLanguage, useEnglish } from "../testUtils";
import { detail } from "./fixtures";
import { QuoteDetailPage } from "./QuoteDetailPage";

const admin = { ...testUser, role: "admin" as const };

beforeEach(async () => { await useEnglish(); });
afterEach(async () => { vi.unstubAllGlobals(); await resetLanguage(); });

const fail = (status: number, error: string) => ({ ok: false, status, json: async () => ({ error }) });

function api(quote = detail({ source: "manual", message: "Called Tuesday" }), extra: Record<string, unknown> = {}) {
  return mockApi({ "GET /api/quotes/5": { quote }, "GET /api/quotes": { quotes: [], counts: { new: 0, customer_replied: 0 } }, "GET /api/clients": { clients: [] }, ...extra });
}

async function openEdit() {
  renderWithProviders(<QuoteDetailPage id={5} />, { session: { user: admin } });
  await screen.findByRole("heading", { name: /D-0005/ });
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  return within(await screen.findByRole("dialog"));
}

describe("editing a saved quote", () => {
  it("shows an Edit button on the quote page", async () => {
    api();
    renderWithProviders(<QuoteDetailPage id={5} />, { session: { user: admin } });
    expect(await screen.findByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("pre-fills the form from the quote, without a client picker", async () => {
    api();
    const dialog = await openEdit();
    expect(dialog.getByRole("heading", { name: "Edit the quote" })).toBeInTheDocument();
    expect(dialog.getByLabelText("Name")).toHaveValue("Maria Silva");
    expect(dialog.getByLabelText("Phone")).toHaveValue("418-555-0100");
    expect(dialog.getByLabelText("Address")).toHaveValue("123 rue Saint-Jean, app. 4");
    expect(dialog.getByLabelText("What the customer asked for")).toHaveValue("Called Tuesday");
    expect(dialog.queryByLabelText("Client")).toBeNull();
  });

  it("sends the whole form to PUT /api/quotes/5/request and confirms", async () => {
    const saved = detail({ source: "manual", message: "Called Tuesday", details: { ...detail().details, address: "9 rue Neuve" }, email: "" });
    const { calls } = api(undefined, { "PUT /api/quotes/5/request": { quote: saved } });
    const dialog = await openEdit();
    fireEvent.change(dialog.getByLabelText("Address"), { target: { value: "9 rue Neuve" } });
    fireEvent.change(dialog.getByLabelText(/^Email/), { target: { value: "" } });
    fireEvent.click(dialog.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.path).toBe("/api/quotes/5/request");
    expect(put.body).toMatchObject({ name: "Maria Silva", phone: "418-555-0100", email: null, kind: "airbnb", city: "Québec", address: "9 rue Neuve", property: "apartment", frequency: "weekly", message: "Called Tuesday" });
    expect(put.body).not.toHaveProperty("client_id");
    expect(await screen.findByText("Quote updated")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("shows a web quote's description as read-only text and does not send it", async () => {
    const { calls } = api(detail({ source: "web" }), { "PUT /api/quotes/5/request": { quote: detail({ source: "web" }) } });
    const dialog = await openEdit();
    expect(dialog.queryByLabelText("What the customer asked for")).toBeNull();
    expect(dialog.getByText("Deux chats, accès par boîte à clé.")).toBeInTheDocument();
    fireEvent.click(dialog.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    expect(calls.find((c) => c.method === "PUT")!.body).not.toHaveProperty("message");
  });

  it("keeps the dialog open and says why when the server refuses", async () => {
    api(undefined, { "PUT /api/quotes/5/request": fail(422, "message_locked") });
    const dialog = await openEdit();
    fireEvent.click(dialog.getByRole("button", { name: "Save" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent("The customer's description cannot be changed.");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
