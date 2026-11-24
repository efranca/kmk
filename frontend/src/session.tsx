import { createContext, useContext, type ReactNode } from "react";

import type { User } from "./api";

export type SessionValue = { user: User; csrfToken: string };

const SessionContext = createContext<SessionValue | null>(null);

/** Who is signed in and the token mutating requests carry, for the pages and hooks below the shell. */
export function SessionProvider({ value, children }: { value: SessionValue; children: ReactNode }) {
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside <SessionProvider>");
  return value;
}
