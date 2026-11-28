import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { testUser, mockApi, renderWithProviders, resetLanguage, useEnglish } from "../testUtils";
import { detail } from "./fixtures";
import { QuoteDetailPage } from "./QuoteDetailPage";

const admin = { ...testUser, role: "admin" as const };
const boss = { ...testUser, role: "superadmin" as const };

beforeEach(async () => { await useEnglish(); });
afterEach(async () => { vi.unstubAllGlobals(); await resetLanguage(); });

const fail = (status: number, error: string) => ({ ok: false, status, json: async () => ({ error }) });

function api(extra: Record<string, unknown> = {}, quote = detail()) {
  return mockApi({ "GET /api/quotes/5": { quote }, "GET /api/quotes": { quotes: [], counts: { new: 0, customer_replied: 0 } }, ...extra });
}

describe("QuoteDetailPage", () => {
  it("shows the request as it was sent", async () => {
    api();
    renderWithProviders(<QuoteDetailPage id={5} />, { session: { user: admin } });
    expect(await screen.findByRole("heading", { name: /D-0005/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "maria@example.com" })).toHaveAttribute("href", "mailto:maria@example.com");
    expect(screen.getByRole("link", { name: "418-555-0100" })).toHaveAttribute("href", "tel:4185550100");
    expect(screen.getByText("Deux chats, accès par boîte à clé.")).toBeInTheDocument();
    expect(screen.getByText("Apartment")).toBeInTheDocument();
    expect(screen.getByText("123 rue Saint-Jean, app. 4")).toBeInTheDocument();
    expect(screen.getByText("Québec")).toBeInTheDocument();
    expect(screen.getByText("Weekly")).toBeInTheDocument();
    expect(screen.getByText("203.0.113.7")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open photo 1" })).toHaveAttribute("href", "/api/quotes/5/photos/3");
    expect(screen.getByRole("link", { name: "Download photo 2 (HEIC)" })).toHaveAttribute("href", "/api/quotes/5/photos/4");
  });

  it("in the installed app a photo opens in a full-screen view inside the app, not as a link that strands an iPhone", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("standalone"), addEventListener: () => undefined, removeEventListener: () => undefined }));
    api();
    renderWithProviders(<QuoteDetailPage id={5} />, { session: { user: admin } });
    await screen.findByRole("heading", { name: /D-0005/ });
    expect(screen.queryByRole("link", { name: "Open photo 1" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open photo 1" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveClass("dialog--full");
    expect(dialog.querySelector("img")).toHaveAttribute("src", "/api/quotes/5/photos/3");
    fireEvent.click(within(dialog).getAllByRole("button", { name: "Close" })[0]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("sends a reply with the subject filled in", async () => {
    const sent = detail({ conversation: [{ id: 1, direction: "out", subject: "Re: Votre soumission de nettoyage D-0005", body: "Voici le prix.", sent_at: "2026-11-25T15:00:00Z", delivery: "sent", author: { id: 1, name: "Ana" } }] });
    const { calls } = api({ "POST /api/quotes/5/messages": { message: sent.conversation[0], quote: sent } });
    renderWithProviders(<QuoteDetailPage id={5} />, { session: { user: admin } });
    await screen.findByRole("heading", { name: /D-0005/ });
    expect(screen.getByLabelText("Subject")).toHaveValue("Re: Votre soumission de nettoyage D-0005");
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Voici le prix." } });
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
    await waitFor(() => expect(calls.find((c) => c.method === "POST")?.body).toEqual({ direction: "out", subject: "Re: Votre soumission de nettoyage D-0005", body: "Voici le prix." }));
  });

  it("tells the team to set the sender when the server says it is missing", async () => {
    api({ "POST /api/quotes/5/messages": fail(409, "sender_not_configured") });
    renderWithProviders(<QuoteDetailPage id={5} />, { session: { user: admin } });
    await screen.findByRole("heading", { name: /D-0005/ });
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Bonjour" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
    expect(await screen.findByText("Set the quote sender in Settings first.")).toBeInTheDocument();
  });

  it("adds a pasted customer reply with its date", async () => {
    const { calls } = api({ "POST /api/quotes/5/messages": { message: {}, quote: detail() } });
    renderWithProviders(<QuoteDetailPage id={5} />, { session: { user: admin } });
    await screen.findByRole("heading", { name: /D-0005/ });
    fireEvent.click(screen.getByRole("button", { name: "Add customer reply" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Customer’s reply"), { target: { value: "Merci, parfait." } });
    fireEvent.change(within(dialog).getByLabelText("Date sent by the customer"), { target: { value: "2026-11-24T10:30" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add to conversation" }));
    await waitFor(() => expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({ direction: "in", body: "Merci, parfait." }));
    const body = calls.find((c) => c.method === "POST")!.body as { sent_at: string };
    expect(new Date(body.sent_at).getTime()).toBe(new Date("2026-11-24T10:30").getTime());
  });

  it("offers a retry for a message that was not sent", async () => {
    const failed = { id: 9, direction: "out" as const, subject: "S", body: "Hello", sent_at: "2026-11-25T15:00:00Z", delivery: "failed" as const, author: { id: 1, name: "Ana" } };
    const { calls } = api({ "POST /api/quotes/5/messages/9/retry": { message: failed, quote: detail() } }, detail({ conversation: [failed] }));
    renderWithProviders(<QuoteDetailPage id={5} />, { session: { user: admin } });
    expect(await screen.findByText("Not sent")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path.endsWith("/retry"))).toBe(true));
  });

  it("changes the status and saves the internal note", async () => {
    const { calls } = api({ "PATCH /api/quotes/5": { quote: detail({ status: "won" }) } });
    renderWithProviders(<QuoteDetailPage id={5} />, { session: { user: admin } });
    await screen.findByRole("heading", { name: /D-0005/ });
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "won" } });
    await waitFor(() => expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ status: "won" }));
    const note = screen.getByLabelText("Internal note");
    fireEvent.change(note, { target: { value: "Rappeler jeudi" } });
    fireEvent.blur(note);
    await waitFor(() => expect(calls.filter((c) => c.method === "PATCH").at(-1)?.body).toEqual({ internal_note: "Rappeler jeudi" }));
  });

  it("offers Delete to the super admin only, after a confirmation", async () => {
    api();
    const view = renderWithProviders(<QuoteDetailPage id={5} />, { session: { user: admin } });
    await screen.findByRole("heading", { name: /D-0005/ });
    expect(screen.queryByRole("button", { name: "Delete quote" })).toBeNull();
    view.unmount();
    const { calls } = api({ "DELETE /api/quotes/5": { ok: true, status: 204, json: async () => ({}) } });
    renderWithProviders(<QuoteDetailPage id={5} />, { session: { user: boss } });
    await screen.findByRole("heading", { name: /D-0005/ });
    fireEvent.click(screen.getByRole("button", { name: "Delete quote" }));
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE")).toBe(true));
  });
});
