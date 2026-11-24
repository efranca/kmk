import { QueryClient } from "@tanstack/react-query";

/** One client per app instance. Reads are cheap and always fresh enough after a mutation invalidates them. */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 15_000 } },
  });
}
