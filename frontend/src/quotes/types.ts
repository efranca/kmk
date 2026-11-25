export type QuoteStatus = "new" | "replied" | "customer_replied" | "won" | "lost";
export type QuoteFilter = QuoteStatus | "all";
export type QuoteKind = "airbnb" | "commercial";

export type QuoteSummary = {
  id: number;
  reference: string;
  status: QuoteStatus;
  kind: QuoteKind;
  name: string;
  email: string;
  phone: string;
  city: string;
  submitted_at: string;
  deadline_at: string;
  /** Past its deadline and still New. */
  overdue: boolean;
  messages: number;
};

export type QuoteMessage = {
  id: number;
  direction: "out" | "in";
  subject: string | null;
  body: string;
  sent_at: string;
  delivery: "sent" | "failed" | null;
  author: { id: number; name: string } | null;
};

export type QuoteDetail = QuoteSummary & {
  locale: "fr-CA" | "en-CA" | "pt-BR";
  details: { property?: string; frequency?: string; bedrooms?: number; bathrooms?: number; area_sqft?: number; city?: string; address?: string };
  message: string | null;
  internal_note: string | null;
  ip: string;
  geo_country: string | null;
  geo_city: string | null;
  user_agent: string | null;
  task_id: number | null;
  event_id: number | null;
  first_reply_at: string | null;
  photos: { id: number; content_type: string; size: number }[];
  conversation: QuoteMessage[];
  default_subject: string;
};

export type QuoteCounts = { new: number; customer_replied: number };
export type QuotePatch = { status?: QuoteStatus; internal_note?: string };
export type MessageInput = { direction: "out"; subject: string; body: string } | { direction: "in"; body: string; sent_at?: string };
