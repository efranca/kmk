# Phase 3 (Account flows): invite, password reset, password change, email

Builds on `scope.md` (§4 tokens, §5 flows, §7 i18n, §9 email), `2026-11-17-kmk-app-design.md` and
`2026-11-17-phase2-core-auth-design.md`. Where this document differs from `scope.md`, this document wins.

## Intent
Let people get into and keep control of their accounts without an admin ever seeing a password: an admin invites a
user by email, the user sets their own password from a single-use link, forgotten passwords are recovered by email,
and signed-in users can change their password. Emails go out in the recipient's language through Resend.
No one needs to be invited yet (the user will invite the ~15 employees once everything is ready), so nothing here is
time-critical; correctness and security come first.

## Goals
- Table `tokens` (invite, reset): hashed, single use, expiring (invite 48 h, reset 30 min).
- Admin endpoints to create+invite a user, re-send an invite, and trigger a reset for a user.
- `POST /api/auth/forgot-password`, `POST /api/auth/set-password`, `POST /api/auth/change-password`.
- An email layer with a Resend backend and a local "log" backend; templates for invite and reset in EN / FR-CA / PT-BR.
- Frontend pages: set password (from the emailed link), forgot password, and a change-password form on the signed-in page.
- Audit events for every sensitive step.

## Non-goals (later)
Admin page/UI, inviting admins (needs TOTP, phase 4), listing/disabling/deleting users, role-change rules, TOTP/MFA,
changing email address, language switcher, Resend account/domain setup (the user does it later, see `2026-11-17-kmk-app-design.md`).

## Anti-goals
- Any response, status code, or timing difference that reveals whether an account exists (forgot-password).
- Raw tokens or links stored in the database or in audit rows; tokens in URL paths/queries (Caddy logs, Referer).
- A request waiting on the mail provider (slow or failing email must not change the response).
- A link that can be used twice, or after a newer one was issued.

## Constraints
- Phase 2 stack and conventions (kmk_app runtime role, INSERT-only audit log with no RETURNING, Origin check on mutating
  requests, per-session CSRF token, real client IP via `X-Real-Client-Ip`).
- Resend is not configured yet; the system must work and be testable without it.
- Link base is `https://app.kmk-entretien.ca` (setting `PUBLIC_BASE_URL`).

## Approaches considered (my calls unless noted)
- **How admins trigger invites before the admin page exists:** CLI, API-only, or a small form. **User: no invites are needed now. Pick: API-only**
  (admin-gated endpoints that the phase 4 page will call); no CLI.
- **Email delivery:** call Resend directly vs a small mail layer with a Resend backend and a local log backend. **Pick: the layer**, default backend `log`
  (writes the whole message, link included, to the API log, for development only); `resend` once `RESEND_API_KEY` is set.
- **Where the token travels in the link:** query string vs URL fragment. **Pick: fragment** (`/set-password#token=...`): fragments are never sent to the server, so Caddy
  logs and Referer headers can't leak it. The page reads it and removes it from the address bar immediately.
- **Frontend routing:** add a router library vs read `location.pathname` by hand. **Pick: by hand** (three pages; Caddy already falls back to `index.html`).
- **Sending mail:** inline vs after the response. **Pick: after the response** (FastAPI background task) so timing can't leak account existence.

## Decisions
**Schema (Alembic `0003`, grants to `kmk_app`):**
- `tokens(token_hash varchar(64) PK, user_id, purpose in ('invite','reset'), created_at, expires_at, used_at)`, index on `user_id`. Full DML for `kmk_app`.
- `users.status` gains `invited`; `users.password_hash` becomes nullable (an invited user has no password yet). Login treats `invited` like any non-active user (generic 401).
- `login_attempts` gains `kind text not null default 'login'` (values `login`, `reset_request`, `token`) so one rate-limit mechanism serves all three.

**Tokens:** 32 random bytes (URL-safe), stored as SHA-256 hex. Issuing a token for a user marks that user's other unused tokens of the same purpose as used.
Redeeming is one atomic `UPDATE ... WHERE token_hash = ? AND used_at IS NULL AND expires_at > now() RETURNING user_id, purpose`; concurrent redeems let exactly one win.

**Endpoints:**
- `POST /api/admin/users` (admin or superadmin, CSRF): `{username, email, locale}` → creates a user with role `user`, status `invited`, issues an invite token, sends the invite
  email; `201 {user, email_sent}`. Duplicate username/email → `409`. Roles other than `user` are not accepted in this phase.
- `POST /api/admin/users/{id}/invite` (admin+): re-issues the invite for an `invited` user (invalidates the earlier link).
- `POST /api/admin/users/{id}/reset` (admin+): emails a reset link to an `active` user. A non-superadmin may not target the superadmin (`403`).
- `POST /api/auth/forgot-password` `{identifier}`: always `202 {"status": "ok"}`, same for existing, unknown, disabled, deleted and invited accounts. For an `active` user it issues a reset token and queues the email.
  Rate limited per IP and per identifier (kind `reset_request`, same numbers as login) → generic `429`.
- `POST /api/auth/set-password` `{token, password}`: for invite or reset tokens. Applies the password rules (`422` with the violated rule codes), sets the Argon2id hash,
  invite → status `active`, reset → **revokes all of the user's sessions**, and marks the user's other outstanding tokens used. Does not log the user in. Any bad token (unknown, expired, used) → one generic `400 {"error": "invalid_token"}`.
  Failed attempts are rate limited per IP (kind `token`).
- `POST /api/auth/change-password` `{current_password, new_password}` (signed in, CSRF): verifies the current password (failures count toward the login rate limit), applies the rules, requires a different password,
  **revokes all other sessions** and keeps the current one.
- All `/api/auth/*` and `/api/admin/*` responses carry `Cache-Control: no-store`.

**Email layer (`app/emails/`):** `send(message) -> bool` over a backend chosen by setting `EMAIL_BACKEND` (`log` default, `resend`). Resend backend: `POST https://api.resend.com/emails`
with bearer `RESEND_API_KEY`, `from` = `EMAIL_FROM` (suggested `KMK Entretien <no-reply@mail.kmk-entretien.ca>`), 10 s timeout, errors caught and logged (never the key), audit `email_failed`.
Templates: invite and reset, each in `fr-CA`, `en`, `pt-BR`, plain text plus simple HTML, with the link `PUBLIC_BASE_URL/set-password#token=...`, the expiry in plain words, and a "ignore this if you did not expect it" line.
The language is the recipient's `locale`.

**Audit events:** `user_invited`, `invite_resent`, `password_reset_requested` (details `via: user|admin`), `invite_accepted`, `password_reset_completed`, `password_changed`, `email_failed`. Details never hold tokens, links or passwords.

**Frontend:** pages `/set-password` (token from the fragment, new password + confirm, rule hints, success message with a link to sign in, generic error for bad links), `/forgot-password`
(identifier → the same confirmation message always), a "Forgot password?" link on the login form, and a change-password form on the signed-in page. Strings in all three languages. The password rules are mirrored client-side as hints only; the server decides.

## Verification the plan must cover
Forgot-password identical for every account state (status, body; the email is only queued for active users); tokens single use, expiring, and superseded by newer ones, with a concurrent-redeem test; reset revokes all sessions;
change-password keeps only the current session; invited users cannot log in until they set a password and then can; admin endpoints reject anonymous (`401`), plain users (`403`), missing CSRF/Origin (`403`), and admin→superadmin reset (`403`);
the Resend backend sends the right request shape (mocked HTTP) and a provider failure neither breaks the response nor leaks the key; links in emails use the fragment form; templates exist for all three languages;
no token, link or password appears in audit rows or in logs outside the dev `log` backend.

## Left to the builder
Module layout, email wording (within the points above), exact error codes for password-rule violations, HTML styling of emails (simple, KMK colors), the dependency for HTTP calls (`httpx` is already a dev dependency; it becomes a runtime one), test fixtures.
