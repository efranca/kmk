// The clients API (backend/app/clients). Tasks, events, documents and quotes point to a client with `client_id`.
import { request } from "../schedule/api";

export type ClientKind = "airbnb" | "commercial" | "post_construction" | "other";

export type Client = {
  id: number;
  name: string;
  kind: ClientKind;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ClientDetail = Client & {
  tasks: { id: number; title: string; status: "pending" | "in_progress" | "completed"; due_date: string | null }[];
  events: { id: number; title: string; start_date: string; start_time: string | null }[];
  documents: { id: number; title: string; content_type: string | null }[];
  quotes: { id: number; reference: string; status: string; kind: string; submitted_at: string | null }[];
};

/** The body of POST and PATCH /api/clients. `quote_id` (create only) links the quote this client comes from. */
export type ClientInput = Omit<Client, "id" | "created_at" | "updated_at"> & { quote_id?: number };

const BASE = "/api/clients";

export const listClients = async () => (await request<{ clients: Client[] }>("GET", BASE)).clients;
export const getClient = async (id: number) => (await request<{ client: ClientDetail }>("GET", `${BASE}/${id}`)).client;
export const createClient = async (input: ClientInput, csrf: string) => (await request<{ client: Client }>("POST", BASE, csrf, input)).client;
export const updateClient = async (id: number, input: ClientInput, csrf: string) => (await request<{ client: Client }>("PATCH", `${BASE}/${id}`, csrf, input)).client;
export const deleteClient = (id: number, csrf: string) => request<void>("DELETE", `${BASE}/${id}`, csrf);
