import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router";

/** Renders under a memory router and a fresh query client with retries off (for component tests). */
export function renderWithProviders(ui: ReactElement, { route = "/" }: { route?: string } = {}): RenderResult {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
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
