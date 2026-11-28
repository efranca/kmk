import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockApi, renderWithProviders, reply, resetLanguage, testUser, useEnglish } from "../testUtils";
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

describe("the rooms and the photos-required switch (administrators)", () => {
  const withRooms = { ...beach, photos_required: false, rooms: [{ id: 1, name: "Kitchen" }, { id: 2, name: "Bathroom" }, { id: 3, name: "Bedroom" }] };
  const page = (properties: unknown[], handlers: Record<string, unknown> = {}) => {
    const api = mockApi({ "GET /api/clients/5": { client: { ...client, properties } }, ...handlers });
    renderWithProviders(<ClientPage id={5} />, admin);
    return api;
  };
  const openNew = async () => {
    fireEvent.click(await screen.findByRole("radio", { name: /Properties/ }));
    fireEvent.click(screen.getByRole("button", { name: "New property" }));
    return within(await screen.findByRole("dialog"));
  };
  const openEdit = async (name: string) => {
    fireEvent.click(await screen.findByRole("radio", { name: /Properties/ }));
    fireEvent.click(within(screen.getByRole("article", { name })).getByRole("button", { name: "Edit property" }));
    return within(await screen.findByRole("dialog"));
  };
  const puts = (api: ReturnType<typeof mockApi>) => api.calls.filter((c) => c.method === "PUT");

  it("offers starter rooms by kind only while the list is empty, and never saves them unless accepted", async () => {
    const api = page([beach], { "POST /api/clients/5/properties": { property: { ...beach, id: 21, rooms: [] } } });
    const dialog = await openNew();
    expect(dialog.getByText(/Suggested rooms: Kitchen, Living room, Bathroom, Bedroom, Entrance/)).toBeInTheDocument();
    fireEvent.change(dialog.getByLabelText("Type"), { target: { value: "commercial" } });
    expect(dialog.getByText(/Suggested rooms: Reception, Offices, Washrooms, Kitchenette/)).toBeInTheDocument();
    expect(dialog.queryByLabelText("Room 1")).toBeNull(); // only a suggestion: nothing is in the list yet
    fireEvent.change(dialog.getByLabelText("Name"), { target: { value: "Cottage" } });
    fireEvent.click(dialog.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST")).toBe(true));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(puts(api)).toHaveLength(0);
  });

  it("does not offer starter rooms when the property already has rooms", async () => {
    page([withRooms]);
    const dialog = await openEdit("Beach house");
    expect(dialog.queryByText(/Suggested rooms/)).toBeNull();
    expect(dialog.getByLabelText("Room 1")).toHaveValue("Kitchen");
    expect(dialog.getByLabelText("Room 3")).toHaveValue("Bedroom");
  });

  it("saves a new property first, then its accepted and edited rooms as one ordered list of new rooms", async () => {
    const api = page([beach], {
      "POST /api/clients/5/properties": { property: { ...beach, id: 21, name: "Cottage", rooms: [] } },
      "PUT /api/properties/21/rooms": { rooms: [] },
    });
    const dialog = await openNew();
    fireEvent.change(dialog.getByLabelText("Name"), { target: { value: "Cottage" } });
    fireEvent.click(dialog.getByRole("button", { name: "Use these rooms" }));
    expect(dialog.queryByText(/Suggested rooms/)).toBeNull();
    fireEvent.change(dialog.getByLabelText("Room 2"), { target: { value: "  Salon  " } });
    fireEvent.click(dialog.getByRole("button", { name: "Remove room 5" })); // Entrance
    fireEvent.click(dialog.getByRole("button", { name: "Add a room" }));
    fireEvent.change(dialog.getByLabelText("Room 5"), { target: { value: "Balcony" } });
    fireEvent.click(dialog.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(puts(api)).toHaveLength(1));
    const post = api.calls.findIndex((c) => c.method === "POST");
    expect(post).toBeGreaterThanOrEqual(0);
    expect(api.calls.findIndex((c) => c.method === "PUT")).toBeGreaterThan(post);
    expect(puts(api)[0]!.body).toEqual({ rooms: [
      { id: null, name: "Kitchen" }, { id: null, name: "Salon" }, { id: null, name: "Bathroom" }, { id: null, name: "Bedroom" }, { id: null, name: "Balcony" },
    ] });
    expect(api.calls.find((c) => c.method === "POST")!.body).not.toHaveProperty("rooms");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("keeps the ids of existing rooms through renames and moves, and sends new rooms with a null id", async () => {
    const api = page([withRooms], {
      "PATCH /api/properties/11": { property: withRooms },
      "PUT /api/properties/11/rooms": { rooms: [] },
    });
    const dialog = await openEdit("Beach house");
    fireEvent.change(dialog.getByLabelText("Room 1"), { target: { value: "Main kitchen" } });
    fireEvent.click(dialog.getByRole("button", { name: "Remove room 3" }));
    fireEvent.click(dialog.getByRole("button", { name: "Move room 2 up" }));
    expect(dialog.getByLabelText("Room 1")).toHaveValue("Bathroom");
    expect(dialog.getByRole("button", { name: "Move room 1 up" })).toBeDisabled();
    expect(dialog.getByRole("button", { name: "Move room 2 down" })).toBeDisabled();
    fireEvent.click(dialog.getByRole("button", { name: "Add a room" }));
    fireEvent.change(dialog.getByLabelText("Room 3"), { target: { value: "Balcony" } });
    fireEvent.click(dialog.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(puts(api)).toHaveLength(1));
    expect(puts(api)[0]!.path).toBe("/api/properties/11/rooms");
    expect(puts(api)[0]!.body).toEqual({ rooms: [{ id: 2, name: "Bathroom" }, { id: 1, name: "Main kitchen" }, { id: null, name: "Balcony" }] });
  });

  it("saves the photos-required switch in the property's body, without touching unchanged rooms", async () => {
    const api = page([withRooms], { "PATCH /api/properties/11": { property: { ...withRooms, photos_required: true } } });
    const dialog = await openEdit("Beach house");
    const box = dialog.getByRole("checkbox", { name: /Photos required/ });
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    fireEvent.click(dialog.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(api.calls.find((c) => c.method === "PATCH")!.body).toMatchObject({ name: "Beach house", photos_required: true });
    expect(api.calls.find((c) => c.method === "PATCH")!.body).not.toHaveProperty("rooms");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(puts(api)).toHaveLength(0);
  });

  it("refuses an empty room name inline and caps the list at 30 rooms", async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: `Room ${i + 1}` }));
    const api = page([withRooms, { ...office, rooms: many }]);
    let dialog = await openEdit("Beach house");
    fireEvent.change(dialog.getByLabelText("Room 2"), { target: { value: "   " } });
    expect(dialog.getByText("Give this room a name.")).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    dialog = await openEdit("Office");
    expect(dialog.getByRole("button", { name: "Add a room" })).toBeDisabled();
    expect(dialog.getByText("At most 30 rooms.")).toBeInTheDocument();
    expect(api.calls.some((c) => c.method !== "GET")).toBe(false);
  });

  it("does not create the property twice when its rooms fail to save: the retry changes it instead", async () => {
    let attempt = 0;
    const api = page([beach], {
      "POST /api/clients/5/properties": { property: { ...beach, id: 21, name: "Cottage", rooms: [] } },
      "PATCH /api/properties/21": { property: { ...beach, id: 21, name: "Cottage", rooms: [] } },
      "PUT /api/properties/21/rooms": () => (++attempt === 1 ? reply(422, { error: "invalid_input" }) : { rooms: [{ id: 7, name: "Kitchen" }] }),
    });
    const dialog = await openNew();
    fireEvent.change(dialog.getByLabelText("Name"), { target: { value: "Cottage" } });
    fireEvent.click(dialog.getByRole("button", { name: "Use these rooms" }));
    fireEvent.click(dialog.getByRole("button", { name: "Save" }));
    expect(await dialog.findByRole("alert")).toBeInTheDocument();
    fireEvent.click(dialog.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(1);
    expect(api.calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
    expect(puts(api)).toHaveLength(2);
  });

  it("shows the rooms and the photos-required mark on the property card", async () => {
    page([{ ...withRooms, photos_required: true }]);
    fireEvent.click(await screen.findByRole("radio", { name: /Properties/ }));
    const card = within(screen.getByRole("article", { name: "Beach house" }));
    expect(card.getByText(/Kitchen, Bathroom, Bedroom/)).toBeInTheDocument();
    expect(card.getByText("Photos required")).toBeInTheDocument();
  });
});
