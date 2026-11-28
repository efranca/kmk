// The JSON of backend/app/invoices. Money is always a string with two decimals ("195.00").
export type InvoiceStatus = "unpaid" | "paid" | "cancelled";

export type InvoiceSummary = {
  id: number;
  number: number;
  /** "007" */
  reference: string;
  client_id: number | null;
  bill_name: string;
  bill_address: string | null;
  bill_city: string | null;
  bill_phone: string | null;
  bill_email: string | null;
  issued_on: string;
  status: InvoiceStatus;
  paid_on: string | null;
  subtotal: string;
  tax: string;
  extra: string;
  total: string;
  sent_at: string | null;
  cancelled_at: string | null;
  document_id: number | null;
};

export type InvoiceLine = { description: string; amount: string; event_id: number | null; occurrence_date: string | null };
export type Invoice = InvoiceSummary & { lines: InvoiceLine[] };

export type InvoiceList = { invoices: InvoiceSummary[]; unpaid_total: string };

/** A past cleaning that can go on an invoice. `occurrence_date` is the original date (the key), `date` the day it happened. */
export type BillableOccurrence = {
  event_id: number;
  occurrence_date: string;
  date: string;
  title: string;
  property_id: number | null;
  property_name: string | null;
  price: string | null;
  description: string;
  /** False when the visit was never closed (no check-out): a hint only, it stays billable. Always false for an item
   * without a property (it has no check-in at all), so the dialog warns only for items with one. */
  checked_out: boolean;
};

export type InvoiceInput = {
  client_id: number;
  issued_on: string;
  extra: string;
  lines: { event_id?: number; occurrence_date?: string; description: string; amount: string }[];
};
