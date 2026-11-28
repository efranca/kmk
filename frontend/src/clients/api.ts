// The clients API (backend/app/clients). Tasks, events, documents and quotes point to a client with `client_id`.
import { request } from "../schedule/api";

export type ClientKind = "airbnb" | "commercial" | "post_construction" | "other";

export type Client = {
  id: number;
  name: string;
  /** One or more: a client can be Airbnb and Commercial at once. */
  kinds: ClientKind[];
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  /** Administrators only: Staff never get the notes. */
  notes?: string | null;
  created_at: string;
  updated_at: string;
};

/** Staff get only `events` (their own), and no `notes`. */
export type Property = {
  id: number;
  client_id: number;
  name: string;
  kind: ClientKind;
  address: string | null;
  city: string | null;
  listing_url: string | null;
  access_notes: string | null;
  /** Administrators only (money string, "120.00"): the price of one visit, used to bill. Staff never get it. */
  visit_price?: string | null;
  /** Check-out needs a photo or a skip with a reason for every room. */
  photos_required?: boolean;
  /** In order: the cleaners pick one for each photo. */
  rooms?: Room[];
};
export type Room = { id: number; name: string };
/** The body of POST and PATCH (the whole form). The rooms are saved apart, with `saveRooms`. */
export type PropertyInput = Omit<Property, "id" | "client_id" | "rooms" | "photos_required"> & { photos_required: boolean };
/** One room of the list sent to `PUT /api/properties/{id}/rooms`: a kept room keeps its id, a new one has `id: null`. */
export type RoomInput = { id: number | null; name: string };

export type ClientDetail = Client & {
  properties: Property[];
  tasks?: { id: number; title: string; status: "pending" | "in_progress" | "completed"; due_date: string | null }[];
  events?: { id: number; title: string; start_date: string; start_time: string | null }[];
  documents?: { id: number; title: string; content_type: string | null }[];
  quotes?: { id: number; reference: string; status: string; kind: string; submitted_at: string | null }[];
  /** Administrators only. */
  invoices?: { id: number; reference: string; issued_on: string; total: string; status: "unpaid" | "paid" | "cancelled" }[];
};

/** The body of POST and PATCH /api/clients. `quote_id` (create only) links the quote this client comes from. */
export type ClientInput = Omit<Client, "id" | "created_at" | "updated_at"> & { quote_id?: number };

const BASE = "/api/clients";

export const listClients = async () => (await request<{ clients: Client[] }>("GET", BASE)).clients;
export const getClient = async (id: number) => (await request<{ client: ClientDetail }>("GET", `${BASE}/${id}`)).client;
export const createClient = async (input: ClientInput, csrf: string) => (await request<{ client: Client }>("POST", BASE, csrf, input)).client;
export const updateClient = async (id: number, input: ClientInput, csrf: string) => (await request<{ client: Client }>("PATCH", `${BASE}/${id}`, csrf, input)).client;
export const deleteClient = (id: number, csrf: string) => request<void>("DELETE", `${BASE}/${id}`, csrf);

export const createProperty = async (clientId: number, input: PropertyInput, csrf: string) => (await request<{ property: Property }>("POST", `${BASE}/${clientId}/properties`, csrf, input)).property;
export const updateProperty = async (id: number, input: PropertyInput, csrf: string) => (await request<{ property: Property }>("PATCH", `/api/properties/${id}`, csrf, input)).property;
export const saveRooms = async (propertyId: number, rooms: RoomInput[], csrf: string) => (await request<{ rooms: Room[] }>("PUT", `/api/properties/${propertyId}/rooms`, csrf, { rooms })).rooms;
export const deleteProperty = (id: number, csrf: string) => request<void>("DELETE", `/api/properties/${id}`, csrf);
