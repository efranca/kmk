// Server state of the quotes (TanStack Query). Every change refreshes the lists, the counts and the open quote.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useSession } from "../session";
import { addMessage, createQuote, editQuote, deleteQuote, getQuote, listQuotes, patchQuote, retryMessage } from "./api";
import type { ManualQuoteInput, MessageInput, QuoteDetail, QuoteFilter, QuotePatch } from "./types";

export const quoteKeys = {
  all: ["quotes"] as const,
  list: (status: QuoteFilter) => ["quotes", "list", status] as const,
  counts: ["quotes", "counts"] as const,
  detail: (id: number) => ["quotes", "detail", id] as const,
};

export function useQuotes(status: QuoteFilter) {
  return useQuery({ queryKey: quoteKeys.list(status), queryFn: () => listQuotes(status) });
}

/** What is waiting for the team (New plus Customer replied), for the navigation badge. Admins only. */
export function useQuoteCounts(enabled: boolean) {
  return useQuery({ queryKey: quoteKeys.counts, queryFn: async () => (await listQuotes("new")).counts, enabled, refetchInterval: 60_000 });
}

export function useQuote(id: number) {
  return useQuery({ queryKey: quoteKeys.detail(id), queryFn: () => getQuote(id) });
}

function useChange<V>(id: number, send: (variables: V, csrf: string) => Promise<QuoteDetail>) {
  const { csrfToken } = useSession();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (variables: V) => send(variables, csrfToken),
    onSuccess: (quote) => {
      client.setQueryData(quoteKeys.detail(id), quote);
      void client.invalidateQueries({ queryKey: quoteKeys.all });
    },
  });
}

export const useUpdateQuote = (id: number) => useChange<QuotePatch>(id, (patch, csrf) => patchQuote(id, patch, csrf));
export const useEditQuote = (id: number) => useChange<Omit<ManualQuoteInput, "client_id">>(id, (input, csrf) => editQuote(id, input, csrf));
export const useSendMessage = (id: number) => useChange<MessageInput>(id, (input, csrf) => addMessage(id, input, csrf));
export const useRetryMessage = (id: number) => useChange<number>(id, (messageId, csrf) => retryMessage(id, messageId, csrf));

export function useDeleteQuote(id: number) {
  const { csrfToken } = useSession();
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => deleteQuote(id, csrfToken),
    onSuccess: () => {
      client.removeQueries({ queryKey: quoteKeys.detail(id) });
      void client.invalidateQueries({ queryKey: quoteKeys.all });
    },
  });
}

/** Enters a quote by hand (a phone call). */
export function useCreateQuote() {
  const { csrfToken } = useSession();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: ManualQuoteInput) => createQuote(input, csrfToken),
    onSuccess: () => client.invalidateQueries({ queryKey: quoteKeys.all }),
  });
}
