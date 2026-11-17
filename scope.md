# app.kmk-entretien.ca – Project Plan

A secure internal web application with invite-only login, an admin page, and a static welcome page. Built to later host customer records and LiteLLM-powered AI features.

## 1. Scope (v1)

- Login page only. No sign-up.
- Users are created by admins and invited by email.
- Login with username or email (case-insensitive).
- Password recovery by email; admins can also trigger a reset.
- Users can change their own password.
- Welcome page with static company info.
- Admin page: manage users, trigger resets, enforce role rules.
- Audit logging of all sensitive actions (stored only, no UI).
- UI languages: English, French (CA), Portuguese (BR). Default: French (CA).
- About 15 users, all employees.

**Out of scope for v1:** AI features, customer records, audit log viewer, editable welcome page, staging and dev environments.

## 2. Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Backend | Python, FastAPI | Easy to learn, async, auto-generated API docs |
| ORM and migrations | SQLAlchemy 2 and Alembic | Standard, well documented |
| Database | PostgreSQL (Docker) | Already in your setup |
| Frontend | React (Vite), react-i18next | Fully separated from the backend |
| Reverse proxy | Caddy | Existing setup, TLS and DNS via Cloudflare |
| Email | Resend | Chosen provider, needs domain verification |
| Passwords | Argon2id | Current best practice |
| Future AI | LiteLLM | Part of the infrastructure |

## 3. Architecture

- Docker Compose with three containers: **Caddy**, **FastAPI**, **Postgres**.
- Postgres is never published to the host. It lives only on the internal Docker network.
- Caddy serves the built React app at `app.kmk-entretien.ca` and proxies `/api/*` to FastAPI.
- One origin means simple cookie auth and no CORS.
- Containers run as non-root.

**Repo layout**

- `backend/` – FastAPI, SQLAlchemy, Alembic
- `frontend/` – React, Vite, react-i18next
- `deploy/` – docker-compose.yml, Caddyfile, `.env.example`

## 4. Data model

**users**

- id, username (lowercase, unique), email (lowercase, unique)
- password\_hash (Argon2id)
- role: `user`, `admin`, `superadmin`
- locale: `fr-CA` (default), `en`, `pt-BR`
- status: `active`, `disabled`, `deleted`
- mfa\_secret (encrypted), mfa\_enabled
- created\_at, updated\_at, deleted\_at (soft delete)

**sessions**

- token\_hash, user\_id, created\_at, expires\_at (5 days), ip, user\_agent, revoked\_at

**tokens** (invite and reset)

- token\_hash, user\_id, purpose (`invite` or `reset`), expires\_at, used\_at
- Invite expires after 48 hours. Reset expires after 30 minutes. Single use.

**audit\_log**

- id, timestamp, actor\_user\_id, action, target\_user\_id, ip, details (JSON)
- Append-only. The app database role has INSERT only, with no UPDATE or DELETE.

**Future-proofing:** customer records will go in the same Postgres. Keep a separate schema for them and a separate read-only DB role for AI tools.

## 5. Authentication flows

**Login**

1. User enters username or email plus password.
2. Lookup is case-insensitive. Verify with Argon2id.
3. Rate limit per IP and per account. Errors are always generic.
4. If MFA is enabled, ask for the TOTP code.
5. Create a server-side session. Set an HttpOnly, Secure, SameSite cookie.

**Invite (onboarding)**

1. Admin creates the user: username, email, role, language.
2. System emails a single-use link in the chosen language.
3. User sets a password. For admins, TOTP setup is required at first login.
4. Event is audit-logged.

**Password reset**

1. User requests it, or an admin triggers it.
2. Response is always the same, whether or not the account exists.
3. Emailed link is single-use and valid for 30 minutes.
4. Setting a new password revokes all sessions.

**Password change**

- Requires the current password.
- Revokes all other sessions.

**Password rules**

- Minimum 8 characters, with letters, numbers and special characters.
- Reviewed later: longer minimum and breached-password check (NIST guidance).

**MFA (TOTP)**

- Available to everyone, **mandatory for admins and the super admin**.
- Recovery codes issued at setup.

## 6. Roles and admin rules

- Admins can create, disable, soft-delete users and trigger password resets.
- Admins can demote or delete other admins.
- The last admin can never be removed or demoted.
- One **super admin** is protected: no one else can modify, demote or delete them.
- Deletion is soft. The record stays so the audit log keeps its references.
- All admin actions are written to the audit log.

## 7. Internationalization

- Languages: English, French (CA), Portuguese (BR).
- Default is French (CA), set per user when the admin creates the account.
- Users can change their language afterwards.
- Frontend: react-i18next. Backend: translated error codes and email templates per user locale.
- Invite and reset emails are sent in the recipient's language.

## 8. Security checklist

**Transport and headers**

- HTTPS only, HSTS, a strict CSP, X-Content-Type-Options, frame protection.
- Cloudflare SSL mode: **Full (strict)**.

**Cookies and CSRF**

- Secure, HttpOnly, SameSite cookies.
- CSRF protection on all mutating requests.

**Real client IPs**

- If `app.kmk-entretien.ca` is proxied by Cloudflare, configure Caddy `trusted_proxies` with Cloudflare ranges and read `CF-Connecting-IP`.
- Otherwise rate limiting and the audit log will see Cloudflare IPs instead of users.

**Secrets and hosts**

- Secrets in `.env`, never in git.
- Firewall: only 80/443 open, SSH restricted to known IPs.
- Automatic OS security updates.

**Application**

- Generic login and reset errors (no user enumeration).
- Rate limiting on login, reset and invite endpoints.
- Hashed session and reset tokens in the database.
- Dependency vulnerability scanning in the build.
- Input validation on every endpoint (Pydantic).

## 9. Email (Resend)

1. Create a Resend account and verify `kmk-entretien.ca`.
2. Add the SPF and DKIM records in Cloudflare as **DNS only** (not proxied).
3. Add a DMARC record.
4. Store the API key in `.env`.
5. Test deliverability to Gmail, Outlook and a Canadian provider before go-live.

## 10. Future: AI and customer records

Not built now, but the design must leave room:

- AI tool calls run **as the logged-in user**, with the same permissions.
- Tools use a **read-only database role**, never the app's main role.
- Know where LiteLLM sends data, and whether the provider retains or trains on it.
- Prompts and tool calls are written to the audit log.
- Customer data sits in its own schema.

## 11. Build phases

1. **Foundation:** Compose, Caddyfile, Postgres, FastAPI health check, Alembic, React shell.
2. **Core auth:** users, sessions, login/logout, rate limiting, audit log.
3. **Account flows:** invite, reset, password change, Resend integration.
4. **Admin:** user management page, role rules, TOTP.
5. **Frontend:** login page, welcome page, i18n (EN, FR-CA, PT-BR), email templates.
6. **Hardening and go-live:** security review, restore test, final checks.

## 12. Accepted risks (revisit later)

| Risk | Status | Note |
| --- | --- | --- |
| Privacy regulation (PIPEDA, Quebec Law 25, LGPD) | Parked | Check with a qualified person before storing real customer data |
| Backups and encryption | Parked, to be prepared separately | Must exist before customer records are added |
| Production only (no dev or staging) | Accepted | Recommend running the same Compose file locally with a different `.env` |
| "Local" hosting | Open | Needs inbound 80/443, stable IP or DDNS, ideally a UPS |
| Password policy fixed at 8 characters | Accepted | Consider 12+ and breach check later |

## 13. Decisions log

- Backend: FastAPI. Frontend: React (Vite).
- Server-side sessions (5 days), not JWTs.
- Argon2id hashing.
- Invite-by-email onboarding. Admins can trigger resets.
- All other sessions revoked on password change.
- Username or email login, case-insensitive.
- Soft delete. Last admin protected. One super admin.
- MFA mandatory for admins, optional for others.
- Email provider: Resend.
- Domain: `app.kmk-entretien.ca`, Caddy with Cloudflare.
- Welcome page content is static for now.
- Audit log is stored only, with no UI.

## 14. Open items

- Confirm whether `app.kmk-entretien.ca` is proxied through Cloudflare.
- Confirm the super admin account and who it belongs to.
- Decide on the Resend sender address (for example `no-reply@kmk-entretien.ca`).
- Write the welcome page copy in EN, FR-CA and PT-BR.
- Schedule the regulation and backup reviews.
