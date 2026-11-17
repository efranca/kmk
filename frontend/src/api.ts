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

export async function forgotPassword(identifier: string): Promise<"ok" | "rate_limited" | "network"> {
  try {
    const r = await fetch("/api/auth/forgot-password", {
      ...base,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier }),
    });
    if (r.status === 429) return "rate_limited";
    return r.ok ? "ok" : "network";
  } catch {
    return "network";
  }
}

export type SetPasswordResult =
  | { ok: true }
  | { ok: false; reason: "invalid_token" | "weak" | "rate_limited" | "network" };

export async function setPassword(token: string, password: string): Promise<SetPasswordResult> {
  try {
    const r = await fetch("/api/auth/set-password", {
      ...base,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    if (r.ok) return { ok: true };
    if (r.status === 400) return { ok: false, reason: "invalid_token" };
    if (r.status === 422) return { ok: false, reason: "weak" };
    if (r.status === 429) return { ok: false, reason: "rate_limited" };
    return { ok: false, reason: "network" };
  } catch {
    return { ok: false, reason: "network" };
  }
}

export type ChangePasswordResult =
  | { ok: true }
  | { ok: false; reason: "wrong_password" | "weak" | "same" | "rate_limited" | "network" };

export async function changePassword(csrfToken: string, current: string, next: string): Promise<ChangePasswordResult> {
  try {
    const r = await fetch("/api/auth/change-password", {
      ...base,
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ current_password: current, new_password: next }),
    });
    if (r.ok) return { ok: true };
    if (r.status === 403) return { ok: false, reason: "wrong_password" };
    if (r.status === 429) return { ok: false, reason: "rate_limited" };
    if (r.status === 422) {
      const body = await r.json().catch(() => ({}));
      return { ok: false, reason: body.error === "same_password" ? "same" : "weak" };
    }
    return { ok: false, reason: "network" };
  } catch {
    return { ok: false, reason: "network" };
  }
}
