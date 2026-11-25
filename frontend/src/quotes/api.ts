import { request } from "../schedule/api";
import type { MessageInput, QuoteCounts, QuoteDetail, QuoteFilter, QuotePatch, QuoteSummary } from "./types";

const BASE = "/api/quotes";

export async function listQuotes(status: QuoteFilter): Promise<{ quotes: QuoteSummary[]; counts: QuoteCounts }> {
  return request("GET", `${BASE}?status=${status}`);
}

export async function getQuote(id: number): Promise<QuoteDetail> {
  return (await request<{ quote: QuoteDetail }>("GET", `${BASE}/${id}`)).quote;
}

export async function patchQuote(id: number, patch: QuotePatch, csrf: string): Promise<QuoteDetail> {
  return (await request<{ quote: QuoteDetail }>("PATCH", `${BASE}/${id}`, csrf, patch)).quote;
}

export async function addMessage(id: number, input: MessageInput, csrf: string): Promise<QuoteDetail> {
  return (await request<{ quote: QuoteDetail }>("POST", `${BASE}/${id}/messages`, csrf, input)).quote;
}

export async function retryMessage(id: number, messageId: number, csrf: string): Promise<QuoteDetail> {
  return (await request<{ quote: QuoteDetail }>("POST", `${BASE}/${id}/messages/${messageId}/retry`, csrf)).quote;
}

export async function deleteQuote(id: number, csrf: string): Promise<void> {
  await request("DELETE", `${BASE}/${id}`, csrf);
}

export const photoUrl = (quoteId: number, photoId: number) => `${BASE}/${quoteId}/photos/${photoId}`;
