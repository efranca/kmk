export class PublicApiError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

async function call<T>(method: string, url: string, init: { json?: unknown; token?: string; body?: BodyInit } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.json !== undefined) headers["Content-Type"] = "application/json";
  if (init.token) headers["X-Quote-Token"] = init.token;
  let response: Response;
  try {
    response = await fetch(url, { method, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body });
  } catch {
    throw new PublicApiError(0, "network");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new PublicApiError(response.status, typeof data?.error === "string" ? data.error : "unknown");
  return data as T;
}

const BASE = "/api/public/quotes";

export type QuoteInput = {
  name: string; email: string; phone: string; locale: string; kind: "airbnb" | "commercial" | "post_construction"; city: string; address: string; property: string; frequency: string;
  bedrooms?: number; bathrooms?: number; area_sqft?: number; message: string | null; website: string;
};

export const publicConfig = () => call<{ phone: string }>("GET", `${BASE}/config`);
export const startQuote = (input: QuoteInput) => call<{ id: number; token: string }>("POST", BASE, { json: input });
export const uploadPhoto = (id: number, token: string, file: File) => call<unknown>("PUT", `${BASE}/${id}/photos`, { token, body: file });
export const submitQuote = async (id: number, token: string) => (await call<{ reference: string }>("POST", `${BASE}/${id}/submit`, { token })).reference;
