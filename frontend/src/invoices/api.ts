// The invoices API (backend/app/invoices). Administrators only.
import { request } from "../schedule/api";
import type { BillableOccurrence, Invoice, InvoiceInput, InvoiceList, InvoiceStatus } from "./types";

export const listInvoices = (status?: InvoiceStatus, q?: string) => {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (q && q.trim()) params.set("q", q.trim());
  const query = params.toString();
  return request<InvoiceList>("GET", `/api/invoices${query ? `?${query}` : ""}`);
};
export const getInvoice = async (id: number) => (await request<{ invoice: Invoice }>("GET", `/api/invoices/${id}`)).invoice;
export const listBillable = async (clientId: number, from: string, to: string) =>
  (await request<{ occurrences: BillableOccurrence[] }>("GET", `/api/clients/${clientId}/billable?${new URLSearchParams({ from, to })}`)).occurrences;
export const createInvoice = async (input: InvoiceInput, csrf: string) => (await request<{ invoice: Invoice }>("POST", "/api/invoices", csrf, input)).invoice;
export const markPaid = async (id: number, paidOn: string, csrf: string) => (await request<{ invoice: Invoice }>("POST", `/api/invoices/${id}/payment`, csrf, { paid_on: paidOn })).invoice;
export const markUnpaid = async (id: number, csrf: string) => (await request<{ invoice: Invoice }>("DELETE", `/api/invoices/${id}/payment`, csrf)).invoice;
export const purgeInvoice = async (id: number, csrf: string) => { await request("DELETE", `/api/invoices/${id}`, csrf); };
export const cancelInvoice = async (id: number, csrf: string) => (await request<{ invoice: Invoice }>("POST", `/api/invoices/${id}/cancel`, csrf)).invoice;
export const sendInvoice = async (id: number, to: string, csrf: string) => (await request<{ invoice: Invoice }>("POST", `/api/invoices/${id}/send`, csrf, { to })).invoice;
export const pdfUrl = (id: number) => `/api/invoices/${id}/pdf`;
