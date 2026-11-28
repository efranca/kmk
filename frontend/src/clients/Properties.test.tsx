import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockApi, renderWithProviders, resetLanguage, testUser, useEnglish } from "../testUtils";
import { ClientPage } from "./ClientPage";
import { EventPlace } from "./EventPlace";
import { googleMapsUrl, isWebLink, placeText, wazeUrl } from "./maps";
import { PropertyPicker } from "./PropertyPicker";

const admin = { session: { user: { ...testUser, role: "admin" as const } } };
const beach = { id: 11, client_id: 5, name: "Beach house", kind: "airbnb", address: "12 chemin de la Plage", city: "Québec", listing_url: "https://www.airbnb.com/rooms/1", access_notes: "Code 4821" };
const office = { id: 12, client_id: 5, name: "Office", kind: "commercial", address: null, city: null, listing_url: null, access_notes: null };
const client = { id: 5, name: "Chantal Roy", kinds: ["airbnb", "commercial"], contact_name: "Chantal", email: "c@example.com", phone: "418-555-0101", address: "1 rue X", city: "Lévis", notes: "Private", created_at: "", updated_at: "", properties: [beach, office], tasks: [], events: [], documents: [], quotes: [] };

beforeEach(async () => { await useEnglish(); });
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); await resetLanguage(); });

describe("maps links", () => {
  it("builds the Google Maps and Waze links from the address, and only trusts web links", () => {
    const place = placeText("12 chemin de la Plage", "Québec");
    expect(place).toBe("12 chemin de la Plage, Québec");
    expect(googleMapsUrl(place)).toBe("https://www.google.com/maps/search/?api=1&query=12%20chemin%20de%20la%20Plage%2C%20Qu%C3%A9bec");
    expect(wazeUrl(place)).toBe("https://waze.com/ul?q=12%20chemin%20de%20la%20Plage%2C%20Qu%C3%A9bec&navigate=yes");
    expect(isWebLink("https://x.ca")).toBe(true);
    expect(isWebLink("javascript:alert(1)")).toBe(false);
    expect(isWebLink(null)).toBe(false);
  });
});

describe("properties", () => {
  it("shows an Agenda item's client, property, map buttons and access notes", async () => {
    mockApi({ "GET /api/clients/5": { client } });
    renderWithProviders(<EventPlace clientId={5} propertyId={11} />, admin);
    expect(await screen.findByRole("link", { name: "Chantal Roy" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "418-555-0101" })).toHaveAttribute("href", "tel:4185550101");
    expect(screen.getByText(/12 chemin de la Plage, Québec/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Google Maps" }).getAttribute("href")).toContain("google.com/maps");
    expect(screen.getByRole("link", { name: "Waze" }).getAttribute("href")).toContain("waze.com/ul");
    expect(screen.getByRole("link", { name: "Listing" })).toHaveAttribute("href", "https://www.airbnb.com/rooms/1");
    expect(screen.getByText(/Code 4821/)).toBeInTheDocument();
  });

  it("shows nothing when the person cannot read the client", async () => {
    mockApi({ "GET /api/clients/5": { ...{ status: 404 }, ok: false, json: async () => ({ error: "not_found" }) } });
    const { container } = renderWithProviders(<EventPlace clientId={5} propertyId={null} />, { session: { user: testUser } });
    await waitFor(() => expect(container.querySelector(".eventplace")).toBeNull());
  });

  it("offers the chosen client's properties, and none until a client is picked", async () => {
    mockApi({ "GET /api/clients/5": { client } });
    const { rerender, unmount } = renderWithProviders(<PropertyPicker clientId={null} value={null} onChange={() => undefined} />, admin);
    expect(screen.queryByLabelText("Property")).toBeNull();
    unmount();
    renderWithProviders(<PropertyPicker clientId={5} value={null} onChange={() => undefined} />, admin);
    expect(await screen.findByRole("option", { name: /Beach house/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Office" })).toBeInTheDocument();
    void rerender;
  });

  it("lists a client's properties on its page and lets an administrator add one", async () => {
    const api = mockApi({ "GET /api/clients/5": { client }, "POST /api/clients/5/properties": { property: beach } });
    renderWithProviders(<ClientPage id={5} />, admin);
    fireEvent.click(await screen.findByRole("radio", { name: /Properties/ }));
    const card = within(screen.getByRole("article", { name: "Beach house" }));
    expect(card.getByText("Code 4821", { exact: false })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "New property" }));
    const dialog = within(await screen.findByRole("dialog"));
    fireEvent.change(dialog.getByLabelText("Name"), { target: { value: "Cottage" } });
    fireEvent.change(dialog.getByLabelText(/Listing link/), { target: { value: "https://www.airbnb.com/rooms/9" } });
    fireEvent.click(dialog.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST")).toBe(true));
    expect(api.calls.find((c) => c.method === "POST")!.body).toMatchObject({ name: "Cottage", kind: "airbnb", listing_url: "https://www.airbnb.com/rooms/9", address: null });
  });

  it("saves the price per visit as a money string, or null when empty, and refuses a bad one", async () => {
    const api = mockApi({ "GET /api/clients/5": { client }, "POST /api/clients/5/properties": { property: beach } });
    renderWithProviders(<ClientPage id={5} />, admin);
    fireEvent.click(await screen.findByRole("radio", { name: /Properties/ }));
    fireEvent.click(screen.getByRole("button", { name: "New property" }));
    const dialog = within(await screen.findByRole("dialog"));
    fireEvent.change(dialog.getByLabelText("Name"), { target: { value: "Cottage" } });
    fireEvent.change(dialog.getByLabelText(/Price per visit/), { target: { value: "-5" } });
    fireEvent.click(dialog.getByRole("button", { name: "Save" }));
    expect(await dialog.findByText("Enter an amount like 120 or 120.50.")).toBeInTheDocument();
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
    fireEvent.change(dialog.getByLabelText(/Price per visit/), { target: { value: "120,5" } });
    fireEvent.click(dialog.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST")).toBe(true));
    expect(api.calls.find((c) => c.method === "POST")!.body).toMatchObject({ name: "Cottage", visit_price: "120.50" });
  });

  it("sends a null price when the field is empty", async () => {
    const api = mockApi({ "GET /api/clients/5": { client }, "POST /api/clients/5/properties": { property: beach } });
    renderWithProviders(<ClientPage id={5} />, admin);
    fireEvent.click(await screen.findByRole("radio", { name: /Properties/ }));
    fireEvent.click(screen.getByRole("button", { name: "New property" }));
    const dialog = within(await screen.findByRole("dialog"));
    fireEvent.change(dialog.getByLabelText("Name"), { target: { value: "Cottage" } });
    fireEvent.click(dialog.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST")).toBe(true));
    expect(api.calls.find((c) => c.method === "POST")!.body).toMatchObject({ visit_price: null });
  });

  it("shows the price on the property card for an administrator", async () => {
    mockApi({ "GET /api/clients/5": { client: { ...client, properties: [{ ...beach, visit_price: "120.00" }, office] } } });
    renderWithProviders(<ClientPage id={5} />, admin);
    fireEvent.click(await screen.findByRole("radio", { name: /Properties/ }));
    expect(within(screen.getByRole("article", { name: "Beach house" })).getByText(/\$120\.00/)).toBeInTheDocument();
    expect(within(screen.getByRole("article", { name: "Office" })).queryByText(/\$/)).toBeNull();
  });

  it("lets Staff read the properties but not change them", async () => {
    const { notes: _n, ...view } = client;
    mockApi({ "GET /api/clients/5": { client: { ...view, tasks: undefined, documents: undefined, quotes: undefined } } });
    renderWithProviders(<ClientPage id={5} />, { session: { user: testUser } });
    fireEvent.click(await screen.findByRole("radio", { name: /Properties/ }));
    expect(screen.getByRole("article", { name: "Beach house" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New property" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit property" })).toBeNull();
  });
});
