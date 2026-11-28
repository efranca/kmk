import type { InvoiceStatus } from "./types";

export type InvoiceTab = "all" | InvoiceStatus;

export const STATUS_KEYS: Record<InvoiceStatus, string> = { unpaid: "invStatusUnpaid", paid: "invStatusPaid", cancelled: "invStatusCancelled" };
export const TABS: InvoiceTab[] = ["all", "unpaid", "paid", "cancelled"];
export const TAB_KEYS: Record<InvoiceTab, string> = { all: "invTabAll", ...STATUS_KEYS };

/** A calendar day ("2026-11-27") for the screen, in the person's language. */
export function formatDay(day: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(`${day}T12:00:00`));
}
