import { DEFAULT_PREFERENCES, type Preferences } from "./preferences";

export type User = {
  id: number;
  username: string;
  name: string | null;
  email: string;
  role: "user" | "admin" | "superadmin";
  locale: "fr-CA" | "en" | "pt-BR";
  avatar_url?: string | null;
};

export type MfaState = "ok" | "verify" | "setup";

export type Session = { user: User; csrfToken: string; mfa: MfaState; mfaEnabled: boolean; preferences: Preferences };

export type LoginResult =
  | ({ ok: true } & Session)
  | { ok: false; reason: "invalid" | "rate_limited" | "network" };

const base: RequestInit = { credentials: "same-origin" };

export async function me(): Promise<Session | null> {
  try {
    const r = await fetch("/api/auth/me", base);
    if (!r.ok) return null;
    const body = await r.json();
    return { user: body.user, csrfToken: body.csrf_token, mfa: body.mfa ?? "ok", mfaEnabled: body.mfa_enabled ?? false, preferences: body.preferences ?? DEFAULT_PREFERENCES };
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
    return { ok: true, user: body.user, csrfToken: body.csrf_token, mfa: body.mfa ?? "ok", mfaEnabled: body.mfa_enabled ?? false, preferences: body.preferences ?? DEFAULT_PREFERENCES };
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

// ---- two-step verification (TOTP) ----

function mfaPost(csrfToken: string, path: string, body: unknown) {
  return fetch(`/api/auth/mfa/${path}`, {
    ...base,
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
    body: JSON.stringify(body),
  });
}

type MfaFailure = "invalid_code" | "rate_limited" | "unavailable" | "network";

export async function mfaSetup(
  csrfToken: string,
): Promise<{ ok: true; secret: string; otpauthUri: string } | { ok: false; reason: "unavailable" | "network" }> {
  try {
    const r = await mfaPost(csrfToken, "setup", {});
    if (r.status === 503) return { ok: false, reason: "unavailable" };
    if (!r.ok) return { ok: false, reason: "network" };
    const body = await r.json();
    return { ok: true, secret: body.secret, otpauthUri: body.otpauth_uri };
  } catch {
    return { ok: false, reason: "network" };
  }
}

export async function mfaEnable(
  csrfToken: string,
  code: string,
): Promise<{ ok: true; recoveryCodes: string[] } | { ok: false; reason: MfaFailure }> {
  try {
    const r = await mfaPost(csrfToken, "enable", { code });
    if (r.ok) return { ok: true, recoveryCodes: (await r.json()).recovery_codes };
    if (r.status === 403) return { ok: false, reason: "invalid_code" };
    if (r.status === 429) return { ok: false, reason: "rate_limited" };
    if (r.status === 503) return { ok: false, reason: "unavailable" };
    return { ok: false, reason: "network" };
  } catch {
    return { ok: false, reason: "network" };
  }
}

export async function mfaVerify(
  csrfToken: string,
  input: { code: string } | { recoveryCode: string },
): Promise<{ ok: true; remaining: number } | { ok: false; reason: MfaFailure }> {
  try {
    const body = "code" in input ? { code: input.code } : { recovery_code: input.recoveryCode };
    const r = await mfaPost(csrfToken, "verify", body);
    if (r.ok) return { ok: true, remaining: (await r.json()).recovery_codes_remaining ?? 0 };
    if (r.status === 403) return { ok: false, reason: "invalid_code" };
    if (r.status === 429) return { ok: false, reason: "rate_limited" };
    if (r.status === 503) return { ok: false, reason: "unavailable" };
    return { ok: false, reason: "network" };
  } catch {
    return { ok: false, reason: "network" };
  }
}

export type ConfirmedResult =
  | { ok: true; recoveryCodes?: string[] }
  | { ok: false; reason: "wrong_password" | "invalid_code" | "mandatory" | "rate_limited" | "unavailable" | "network" };

async function confirmed(csrfToken: string, path: string, password: string, code: string): Promise<ConfirmedResult> {
  try {
    const r = await mfaPost(csrfToken, path, { password, code });
    if (r.ok) return { ok: true, recoveryCodes: (await r.json()).recovery_codes };
    if (r.status === 429) return { ok: false, reason: "rate_limited" };
    if (r.status === 503) return { ok: false, reason: "unavailable" };
    if (r.status === 403) {
      const error = (await r.json().catch(() => ({}))).error;
      if (error === "mfa_mandatory") return { ok: false, reason: "mandatory" };
      if (error === "invalid_current_password") return { ok: false, reason: "wrong_password" };
      return { ok: false, reason: "invalid_code" };
    }
    return { ok: false, reason: "network" };
  } catch {
    return { ok: false, reason: "network" };
  }
}

export const mfaDisable = (csrfToken: string, password: string, code: string) => confirmed(csrfToken, "disable", password, code);
export const mfaRegenerate = (csrfToken: string, password: string, code: string) =>
  confirmed(csrfToken, "recovery-codes/regenerate", password, code);

// ---- administration ----

export type AdminUser = {
  id: number;
  username: string;
  name: string | null;
  email: string;
  role: "user" | "admin" | "superadmin";
  locale: "fr-CA" | "en" | "pt-BR";
  status: "invited" | "active" | "disabled" | "deleted";
  mfaEnabled: boolean;
  createdAt: string;
  lastSignIn: string | null;
  actions: string[];
};

export type AdminError = "forbidden" | "self" | "invalid_state" | "last_admin" | "exists" | "invalid" | "network";
export type AdminResult = { ok: true } | { ok: false; reason: AdminError };

export async function adminList(): Promise<AdminUser[] | null> {
  try {
    const r = await fetch("/api/admin/users", base);
    if (!r.ok) return null;
    const body = await r.json();
    return body.users.map((u: Record<string, unknown>) => ({
      id: u.id,
      username: u.username,
      name: u.name ?? null,
      email: u.email,
      role: u.role,
      locale: u.locale,
      status: u.status,
      mfaEnabled: u.mfa_enabled,
      createdAt: u.created_at,
      lastSignIn: u.last_sign_in ?? null,
      actions: u.actions ?? [],
    }));
  } catch {
    return null;
  }
}

async function adminCall(csrfToken: string, method: string, path: string, body?: unknown): Promise<AdminResult> {
  try {
    const r = await fetch(`/api/admin/${path}`, {
      ...base,
      method,
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (r.ok) return { ok: true };
    const error = (await r.json().catch(() => ({}))).error;
    if (r.status === 422) return { ok: false, reason: "invalid" }; // for example a name the server refuses
    if (r.status === 403) return { ok: false, reason: error === "cannot_target_self" ? "self" : "forbidden" };
    if (r.status === 409) {
      if (error === "last_admin") return { ok: false, reason: "last_admin" };
      if (error === "already_exists") return { ok: false, reason: "exists" };
      return { ok: false, reason: "invalid_state" };
    }
    return { ok: false, reason: "network" };
  } catch {
    return { ok: false, reason: "network" };
  }
}

export const adminInvite = (csrf: string, v: { name: string; username: string; email: string; locale: string; role: "user" | "admin" }) =>
  adminCall(csrf, "POST", "users", v);
export const adminAct = (csrf: string, id: number, action: "invite" | "reset" | "disable" | "enable" | "delete" | "restore" | "reset-mfa") =>
  adminCall(csrf, "POST", `users/${id}/${action}`);
export const adminSetRole = (csrf: string, id: number, role: "user" | "admin") => adminCall(csrf, "POST", `users/${id}/role`, { role });
export const adminEdit = (csrf: string, id: number, v: { locale?: string; email?: string; name?: string }) => adminCall(csrf, "PATCH", `users/${id}`, v);

export async function setLocale(csrfToken: string, locale: string): Promise<{ ok: true; user: User } | { ok: false }> {
  try {
    const r = await fetch("/api/auth/locale", {
      ...base,
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ locale }),
    });
    if (!r.ok) return { ok: false };
    return { ok: true, user: (await r.json()).user };
  } catch {
    return { ok: false };
  }
}
