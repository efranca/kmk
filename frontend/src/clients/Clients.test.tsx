import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockApi, renderWithProviders, resetLanguage, testUser, useEnglish } from "../testUtils";
import { ClientPage } from "./ClientPage";
import { ClientPicker } from "./ClientPicker";
import { ClientsPage } from "./ClientsPage";

const admin = { session: { user: { ...testUser, role: "admin" as const } } };
const chantal = { id: 5, name: "Chantal Roy", kinds: ["airbnb", "commercial"], contact_name: "Chantal", email: "c@example.com", phone: "418-555-0101", address: "12 rue Saint-Jean", city: "Québec", notes: "Key under the mat", created_at: "2026-11-27T10:00:00Z", updated_at: "2026-11-27T10:00:00Z" };
const detail = { ...chantal, tasks: [{ id: 1, title: "Call Chantal", status: "pending", due_date: "2026-11-30" }], events: [{ id: 2, title: "Deep clean", start_date: "2026-12-04", start_time: "10:00" }], documents: [{ id: 3, title: "Lease", content_type: "application/pdf" }], quotes: [{ id: 9, reference: "D-0009", status: "won", kind: "airbnb", submitted_at: "2026-11-20T10:00:00Z" }] };

beforeEach(async () => { await useEnglish(); });
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); await resetLanguage(); });

describe("clients", () => {
  it("lists the clients and finds one by its phone number", async () => {
    mockApi({ "GET /api/clients": { clients: [chantal, { ...chantal, id: 6, name: "Marc Dion", phone: "514-555-0000", city: "Laval" }] } });
    renderWithProviders(<ClientsPage />, admin);
    expect(await screen.findByText("Chantal Roy")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Search clients" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "514" } });
    expect(screen.queryByText("Chantal Roy")).toBeNull();
    expect(screen.getByText("Marc Dion")).toBeInTheDocument();
  });

  it("adds a client", async () => {
    const api = mockApi({ "GET /api/clients": { clients: [] }, "POST /api/clients": { client: chantal } });
    renderWithProviders(<ClientsPage />, admin);
    fireEvent.click(await screen.findByRole("button", { name: "New client" }));
    const dialog = within(await screen.findByRole("dialog"));
    fireEvent.change(dialog.getByLabelText("Name"), { target: { value: "  Chantal Roy " } });
    fireEvent.change(dialog.getByLabelText("Phone"), { target: { value: "418-555-0101" } });
    fireEvent.click(dialog.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST")).toBe(true));
    expect(api.calls.find((c) => c.method === "POST")!.body).toMatchObject({ name: "Chantal Roy", phone: "418-555-0101", kinds: ["other"], email: null, notes: null });
  });

  it("lets a client be several kinds at once, and needs at least one", async () => {
    const api = mockApi({ "GET /api/clients": { clients: [] }, "POST /api/clients": { client: chantal } });
    renderWithProviders(<ClientsPage />, admin);
    fireEvent.click(await screen.findByRole("button", { name: "New client" }));
    const dialog = within(await screen.findByRole("dialog"));
    fireEvent.change(dialog.getByLabelText("Name"), { target: { value: "Chantal" } });
    expect(dialog.getByRole("checkbox", { name: "Other" })).toBeChecked();
    fireEvent.click(dialog.getByRole("checkbox", { name: "Other" }));
    expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.click(dialog.getByRole("checkbox", { name: "Commercial" }));
    fireEvent.click(dialog.getByRole("checkbox", { name: "Airbnb" }));
    fireEvent.click(dialog.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST")).toBe(true));
    expect(api.calls.find((c) => c.method === "POST")!.body).toMatchObject({ kinds: ["airbnb", "commercial"] });
  });

  it("shows a client's details and what is linked to them", async () => {
    const lease = { id: 3, title: "Lease", note: null, category_id: null, client_id: 5, visibility: "admins", file_name: "lease.pdf", content_type: "application/pdf", size_bytes: 2048, has_file: true, has_preview: false, created_by: { id: 1, name: "Alice" }, created_at: "2026-11-20T10:00:00Z", updated_at: "2026-11-20T10:00:00Z" };
    mockApi({ "GET /api/clients/5": { client: { ...detail, properties: [] } }, "GET /api/documents": { documents: [lease, { ...lease, id: 4, title: "Other client's", client_id: 6 }], categories: [] } });
    renderWithProviders(<ClientPage id={5} />, admin);
    expect(await screen.findByText("Key under the mat")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Call" })).toHaveAttribute("href", "tel:4185550101");
    expect(screen.getByRole("link", { name: "Email" })).toHaveAttribute("href", "mailto:c@example.com");
    fireEvent.click(screen.getByRole("radio", { name: /Documents/ }));
    expect(await screen.findByRole("button", { name: /Lease/ })).toBeInTheDocument(); // a row like on the Documents page
    expect(screen.queryByText("Other client's")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add a document" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog")).getAllByRole("button", { name: "Cancel" })[0]!);
    fireEvent.click(screen.getByRole("radio", { name: /Tasks/ }));
    expect(screen.getByText("Call Chantal")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /Quotes/ }));
    expect(screen.getByText("D-0009")).toBeInTheDocument();
  });

  it("offers the client picker to everyone, listing what the server lets them see", async () => {
    mockApi({ "GET /api/clients": { clients: [chantal] } });
    const { unmount } = renderWithProviders(<ClientPicker value={null} onChange={() => undefined} />, admin);
    expect(await screen.findByRole("option", { name: "Chantal Roy" })).toBeInTheDocument();
    unmount();
    renderWithProviders(<ClientPicker value={null} onChange={() => undefined} />, { session: { user: testUser } });
    expect(await screen.findByRole("option", { name: "Chantal Roy" })).toBeInTheDocument();
  });

  it("gives Staff the details and their Schedule only, with no editing", async () => {
    const { notes: _notes, ...staffView } = chantal;
    mockApi({ "GET /api/clients/5": { client: { ...staffView, events: detail.events } } });
    renderWithProviders(<ClientPage id={5} />, { session: { user: testUser } });
    expect(await screen.findByText("12 rue Saint-Jean, Québec")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit client" })).toBeNull();
    expect(screen.queryByRole("radio", { name: /Documents|Tasks|Quotes/ })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /Schedule/ }));
    expect(screen.getByText("Deep clean")).toBeInTheDocument();
  });
});
