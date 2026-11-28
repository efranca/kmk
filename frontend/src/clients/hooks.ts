import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useSession } from "../session";
import { createClient, createProperty, deleteClient, deleteProperty, getClient, listClients, saveRooms, updateClient, updateProperty, type ClientInput, type PropertyInput, type RoomInput } from "./api";

export const clientKeys = { all: ["clients"] as const, list: ["clients", "list"] as const, one: (id: number) => ["clients", "one", id] as const };

/** `enabled` is false for people who may not read clients (the server would answer 403). */
export function useClients(enabled = true) {
  return useQuery({ queryKey: clientKeys.list, queryFn: listClients, enabled, staleTime: 30_000 });
}

export function useClient(id: number, enabled = true) {
  return useQuery({ queryKey: clientKeys.one(id), queryFn: () => getClient(id), enabled, retry: false });
}

/** Creates (no `id`) or changes a client. */
export function useSaveClient() {
  const { csrfToken } = useSession();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: number; input: ClientInput }) => (id ? updateClient(id, input, csrfToken) : createClient(input, csrfToken)),
    // A new client from a quote also changes that quote.
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: clientKeys.all }), qc.invalidateQueries({ queryKey: ["quotes"] })]),
  });
}

export function useDeleteClient() {
  const { csrfToken } = useSession();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteClient(id, csrfToken),
    onSuccess: () => qc.invalidateQueries(),
  });
}

/** Adds (no `id`) or changes a property of a client. */
export function useSaveProperty(clientId: number) {
  const { csrfToken } = useSession();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: number; input: PropertyInput }) => (id ? updateProperty(id, input, csrfToken) : createProperty(clientId, input, csrfToken)),
    onSuccess: () => qc.invalidateQueries({ queryKey: clientKeys.all }),
  });
}

/** Replaces a property's room list (one ordered list). The visits show the rooms too. */
export function useSaveRooms() {
  const { csrfToken } = useSession();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ propertyId, rooms }: { propertyId: number; rooms: RoomInput[] }) => saveRooms(propertyId, rooms, csrfToken),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: clientKeys.all }), qc.invalidateQueries({ queryKey: ["visits"] })]),
  });
}

export function useDeleteProperty() {
  const { csrfToken } = useSession();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteProperty(id, csrfToken),
    onSuccess: () => qc.invalidateQueries(), // Agenda items that pointed to it lose the link too
  });
}
