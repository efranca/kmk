import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { clientKeys } from "../clients/hooks";
import { useSession } from "../session";
import { cancelInvoice, purgeInvoice, createInvoice, getInvoice, listBillable, listInvoices, markPaid, markUnpaid, sendInvoice } from "./api";
import type { InvoiceInput, InvoiceStatus } from "./types";

export const invoiceKeys = {
  all: ["invoices"] as const,
  list: (status: InvoiceStatus | undefined, q: string) => ["invoices", "list", status ?? "all", q] as const,
  detail: (id: number) => ["invoices", "one", id] as const,
  billable: (clientId: number, from: string, to: string) => ["invoices", "billable", clientId, from, to] as const,
};

export function useInvoices(status: InvoiceStatus | undefined, q: string) {
  return useQuery({ queryKey: invoiceKeys.list(status, q), queryFn: () => listInvoices(status, q), staleTime: 15_000 });
}

export function useInvoice(id: number) {
  return useQuery({ queryKey: invoiceKeys.detail(id), queryFn: () => getInvoice(id), retry: false });
}

export function useBillable(clientId: number, from: string, to: string, enabled = true) {
  return useQuery({ queryKey: invoiceKeys.billable(clientId, from, to), queryFn: () => listBillable(clientId, from, to), enabled, retry: false, gcTime: 0 });
}

/** Every change refreshes the invoices and the client pages (they list their invoices). */
function useInvoiceMutation<V, R>(run: (variables: V, csrf: string) => Promise<R>) {
  const { csrfToken } = useSession();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (variables: V) => run(variables, csrfToken),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: invoiceKeys.all }), qc.invalidateQueries({ queryKey: clientKeys.all })]),
  });
}

export const useCreateInvoice = () => useInvoiceMutation((input: InvoiceInput, csrf) => createInvoice(input, csrf));
export const useMarkPaid = () => useInvoiceMutation(({ id, paidOn }: { id: number; paidOn: string }, csrf) => markPaid(id, paidOn, csrf));
export const useMarkUnpaid = () => useInvoiceMutation((id: number, csrf) => markUnpaid(id, csrf));
export const useCancelInvoice = () => useInvoiceMutation((id: number, csrf) => cancelInvoice(id, csrf));
export const usePurgeInvoice = () => useInvoiceMutation((id: number, csrf) => purgeInvoice(id, csrf));
export const useSendInvoice = () => useInvoiceMutation(({ id, to }: { id: number; to: string }, csrf) => sendInvoice(id, to, csrf));
