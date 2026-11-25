import type { QuoteDetail, QuoteSummary } from "./types";

export const summary = (over: Partial<QuoteSummary> = {}): QuoteSummary => ({
  id: 5, reference: "D-0005", status: "new", kind: "airbnb", name: "Maria Silva", email: "maria@example.com", phone: "418-555-0100", city: "Québec", submitted_at: "2026-11-25T14:00:00Z",
  deadline_at: "2026-11-26T14:00:00Z", overdue: false, messages: 0, ...over,
});

export const detail = (over: Partial<QuoteDetail> = {}): QuoteDetail => ({
  ...summary(), locale: "fr-CA",
  details: { city: "Québec", property: "apartment", frequency: "weekly", bedrooms: 2, bathrooms: 1.5, area_sqft: 900 },
  message: "Deux chats, accès par boîte à clé.", internal_note: null, ip: "203.0.113.7", geo_country: "CA", geo_city: "Quebec",
  user_agent: "Test", task_id: 11, event_id: 12, first_reply_at: null, photos: [{ id: 3, content_type: "image/jpeg", size: 1000 }, { id: 4, content_type: "image/heic", size: 2000 }],
  conversation: [], default_subject: "Re: Votre soumission de nettoyage D-0005", ...over,
});
