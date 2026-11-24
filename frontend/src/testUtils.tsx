import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router";
import { vi } from "vitest";

import type { User } from "./api";
import i18n from "./i18n";
import { SessionProvider, type SessionValue } from "./session";
import type { Occurrence } from "./schedule/types";
import type { Person } from "./ui/Avatar";
import { ToastProvider } from "./ui/Toast";

export const testUser: User = { id: 1, username: "alice", name: "Alice Roy", email: "alice@example.com", role: "user", locale: "en" };

/** Renders under a memory router, a fresh query client with retries off, a session and the toast area. */
export function renderWithProviders(
  ui: ReactElement,
  { route = "/", session }: { route?: string; session?: Partial<SessionValue> } = {},
): RenderResult {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const value: SessionValue = { user: testUser, csrfToken: "tok-1", ...session };
  return render(
    <QueryClientProvider client={client}>
      <SessionProvider value={value}>
        <ToastProvider>
          <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
        </ToastProvider>
      </SessionProvider>
    </QueryClientProvider>,
  );
}

/** Opens the signed-in account menu (the avatar button) and returns the button; language independent. */
export function openAccountMenu(): HTMLElement {
  const button = document.querySelector<HTMLElement>("[data-account-menu]");
  if (!button) throw new Error("the account menu button is not on the page");
  if (button.getAttribute("aria-expanded") !== "true") fireEvent.click(button);
  return button;
}

/** English for the test, French (the app's default) again afterwards. */
export async function useEnglish(): Promise<void> {
  await act(() => i18n.changeLanguage("en"));
}
export async function resetLanguage(): Promise<void> {
  await act(() => i18n.changeLanguage("fr-CA"));
}

let counter = 0;
/** An occurrence on Thursday 12 November 2026, 10:00-11:00, for everyone, unless overridden. */
export function occurrence(over: Partial<Occurrence> = {}): Occurrence {
  counter += 1;
  return {
    event_id: counter, original_date: "2026-11-12", date: "2026-11-12", start_time: "10:00", end_time: "11:00", all_day: false,
    title: "Event", notes: null, icon: null, color: "blue", repeating: false, modified: false, people: [], created_by: 1, ...over,
  };
}

export function person(id: number, name: string, color: Person["color"] = "teal"): Person {
  return { id, name, color };
}

export const reply = (status: number, body: unknown = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
type Call = { method: string; path: string; query: string; body: unknown };
type Handler = (call: Call & { url: URL }) => unknown;

/** Replaces fetch: handlers are keyed "GET /api/schedule/events"; a handler returns the JSON body, or reply(status, body). */
export function mockApi(handlers: Record<string, Handler | Record<string, unknown>>): { calls: Call[]; fetch: ReturnType<typeof vi.fn> } {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, "http://localhost");
    const method = init?.method ?? "GET";
    const call: Call = { method, path: url.pathname, query: url.search, body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    const handler = handlers[`${method} ${url.pathname}`];
    if (handler === undefined) throw new Error(`unexpected ${method} ${url.pathname}`);
    const out = typeof handler === "function" ? (handler as Handler)({ ...call, url }) : handler;
    return out && typeof out === "object" && "ok" in out && "status" in out ? out : reply(200, out);
  });
  vi.stubGlobal("fetch", fn);
  return { calls, fetch: fn };
}
