export type User = {
  id: number;
  username: string;
  email: string;
  role: "user" | "admin" | "superadmin";
  locale: "fr-CA" | "en" | "pt-BR";
};

export type Session = { user: User; csrfToken: string };

export type LoginResult =
  | ({ ok: true } & Session)
  | { ok: false; reason: "invalid" | "rate_limited" | "network" };

const base: RequestInit = { credentials: "same-origin" };

export async function me(): Promise<Session | null> {
  try {
    const r = await fetch("/api/auth/me", base);
    if (!r.ok) return null;
    const body = await r.json();
    return { user: body.user, csrfToken: body.csrf_token };
  } catch {
    return null;
  }
}

export async function login(identifier: string, password: string): Promise<LoginResult> {
  try {
    const r = await fetch("/api/auth/login", {
      ...base,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, password }),
    });
    if (r.status === 429) return { ok: false, reason: "rate_limited" };
    if (!r.ok) return { ok: false, reason: "invalid" };
    const body = await r.json();
    return { ok: true, user: body.user, csrfToken: body.csrf_token };
  } catch {
    return { ok: false, reason: "network" };
  }
}

export async function logout(csrfToken: string): Promise<void> {
  try {
    await fetch("/api/auth/logout", { ...base, method: "POST", headers: { "X-CSRF-Token": csrfToken } });
  } catch {
    // The session cookie may still be valid; the UI returns to the login form regardless.
  }
}
