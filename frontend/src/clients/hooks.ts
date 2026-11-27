import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useSession } from "../session";
import { createClient, deleteClient, getClient, listClients, updateClient, type ClientInput } from "./api";

export const clientKeys = { all: ["clients"] as const, list: ["clients", "list"] as const, one: (id: number) => ["clients", "one", id] as const };

/** `enabled` is false for people who may not read clients (the server would answer 403). */
export function useClients(enabled = true) {
  return useQuery({ queryKey: clientKeys.list, queryFn: listClients, enabled, staleTime: 30_000 });
}

export function useClient(id: number) {
  return useQuery({ queryKey: clientKeys.one(id), queryFn: () => getClient(id) });
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
