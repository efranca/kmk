# Phase 2 (Core auth): users, sessions, login/logout, rate limiting, audit log

Builds on `scope.md` (§4 data model, §5 login flow, §6 roles, §8 security) and
`2026-11-17-kmk-app-design.md`. Where this document differs from `scope.md`, this document wins.

## Intent
Make `app.kmk-entretien.ca` require a login. After phase 2 an existing user can sign in with username or email,
see who they are, and sign out, and every sensitive event is recorded in an append-only audit log. It is the
base that invites, resets, admin and (later) customer data are built on, so correctness and security matter more
than features. The user chose to include a minimal login page now (not API-only).

## Goals
- Tables `users`, `sessions`, `audit_log` (+ `login_attempts`, see decisions) as in `scope.md` §4, via Alembic revision `0002`.
- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`.
- Argon2id passwords; server-side sessions (5 days, absolute); generic errors; per-IP and per-account rate limiting.
- Audit log is append-only at the database level: the API role cannot UPDATE or DELETE it.
- A CLI to create the single super admin (there is no sign-up and invites arrive in phase 3).
- Minimal frontend: login form and a signed-in page with logout, in the KMK look, in EN / FR-CA / PT-BR.

## Non-goals (later phases)
Invites, password reset and change, TOTP/MFA flow (columns exist, unused), admin page and role rules, welcome page,
language switcher, session-list UI, sliding/idle session expiry, audit log viewer.

## Anti-goals
Anything that lets a login attempt reveal whether an account exists (messages, status codes, or timing);
secrets or password hashes in logs, audit details, or API responses; the API connecting as the table owner.

## Constraints
- Existing stack from phase 1 (FastAPI, SQLAlchemy 2, psycopg 3, Alembic, React/Vite, shared Postgres on `127.0.0.1:5432`,
  Caddy on `127.0.0.1:8081`, API on `127.0.0.1:8001`). Nothing is bound beyond loopback.
- Browser traffic is HTTPS via Cloudflare; the origin sees HTTP. Cookies are `Secure` regardless (`COOKIE_SECURE=true`).
- Real client IP: Caddy gets it from `Cf-Connecting-Ip` (trusted proxy 127.0.0.1) and forwards it as `X-Forwarded-For`.
  The API trusts that header only when the TCP peer is loopback. The builder verifies, through Caddy, that the API sees the
  Cloudflare-reported client IP and that a client-supplied `X-Forwarded-For` cannot spoof it.
- famillai and the shared Postgres setup are not modified, except creating the `kmk_app` role.

## Approaches considered (my calls unless noted)
- **Screen scope:** API only vs minimal login page. **User chose the minimal login page.**
- **Rate-limit storage:** in-memory (simple, resets on restart, lost on crash) vs a Postgres table (survives restarts, one small
  table) vs counting rows in `audit_log` (no table, but the app role would need SELECT on the audit log). **Pick: a small
  `login_attempts` table.**
- **CSRF:** SameSite only vs a per-session token vs Origin check only. **Pick: layered**: `SameSite=Strict` cookie, an Origin check on every
  mutating request, and a per-session token header on authenticated mutating requests.
- **Migrations vs runtime role:** one role for both vs two. **Pick: two** (below), so the API cannot alter or delete audit rows.

## Decisions
**Database roles** (`kmk_app` is created by hand with psql like `kmk`, password in `deploy/.env`; migrations grant to it):
- `kmk` (owner): migrations only, via `MIGRATION_DATABASE_URL`. The container entrypoint runs Alembic with it.
- `kmk_app`: runtime, via `DATABASE_URL`. SELECT/INSERT/UPDATE/DELETE on `users`, `sessions`, `login_attempts`;
  **INSERT only on `audit_log`** (plus its sequence); CONNECT on the database and USAGE on schema `public`.
  Phase 1's health check moves to this role too.

**Schema** (`scope.md` §4 columns, plus):
- `users.username` / `users.email` stored lowercase, unique. A partial unique index allows only one `role = 'superadmin'`.
  `role` in (`user`,`admin`,`superadmin`), `locale` in (`fr-CA`,`en`,`pt-BR`) default `fr-CA`, `status` in (`active`,`disabled`,`deleted`), enforced by CHECK constraints.
- `sessions.token_hash` is the primary key: SHA-256 of a 32-byte random token. The raw token only lives in the cookie.
- `login_attempts(id, at, ip, identifier, success)`: `identifier` is the submitted, lowercased, length-capped value; old rows pruned.
- `audit_log` as in `scope.md` (append-only).

**Login** (`POST /api/auth/login`, body `{identifier, password}`):
- Case-insensitive lookup by username or email. Wrong user, wrong password, disabled and deleted accounts all return the same `401` body
  and do the same work (a dummy Argon2id verify when the user doesn't exist).
- Argon2id via `argon2-cffi` defaults; rehash on login if parameters are outdated.
- Rate limits (my numbers, config values): per IP 10 failed attempts and per submitted identifier 5 failed attempts in 15 minutes, then `429`
  with a generic body, counted by the submitted identifier whether or not it exists. Known trade-off: someone can lock a real colleague out of
  login for up to 15 minutes by spamming their name; accepted at 15 users.
- Success: new session row (ip, user agent), cookie `kmk_session` (HttpOnly, Secure, SameSite=Strict, Path=/api, Max-Age 5 days), response `{user: {id, username, email, role, locale}, csrf_token}`.
- A session is valid only if not revoked, not expired and its user is `active`.
- `POST /api/auth/logout` revokes the session and clears the cookie. `GET /api/auth/me` returns the user and csrf token, or `401`.
- CSRF token = HMAC-SHA256 of the session id with a server secret (`SESSION_SECRET` in `.env`), sent as `X-CSRF-Token`.

**Passwords:** a validator for the `scope.md` §5 rule (min 8, letters, numbers, special characters) lives in the backend and is used by the CLI now, by
invite/reset/change later.

**Audit events written now:** `login_success`, `login_failed`, `login_rate_limited`, `logout`, `user_created` (CLI, actor null). Details JSON never holds passwords or hashes.

**CLI:** `python -m app.cli create-superadmin --username U --email E [--locale L]`, password read with a hidden prompt (never in argv), validated, run inside
the container (`docker compose exec api ...`). Refuses if a super admin already exists. Who the super admin is stays an open item; it is chosen when the command is run.

**Frontend:** if `/api/auth/me` is 401 show the login form (identifier, password, submit; generic error and rate-limit messages translated in all three languages); otherwise
a signed-in page (name, role, logout button). After login the page switches to the user's locale. No router library. CSRF token kept in memory only.

## Verification the plan must cover
Wrong password / unknown user / disabled user are indistinguishable (body, status, rough timing); rate limit trips for IP and identifier and is generic; `kmk_app`
UPDATE/DELETE on `audit_log` fails and INSERT works; logout and expiry invalidate the cookie; a mutating request without a valid Origin or token is rejected; a forged
`X-Forwarded-For` does not change the recorded IP; passwords/hashes appear nowhere in logs or audit rows.

## Left to the builder
Module layout, Argon2 library tuning, table/index names, exact error codes and translation strings, the Origin allow-list setting, how pruning of
`login_attempts` runs, the test database fixtures.
