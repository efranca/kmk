# Phase 4a (TOTP): two-step login, enrollment, recovery codes, mandatory for admins

Phase 4 is split in two (user's choice, on my recommendation): **4a** (this document) is TOTP; **4b** is the admin page,
user lifecycle endpoints (disable, delete, role change, admin-triggered MFA reset) and role rules, designed after 4a ships.
Builds on `scope.md` (§4 users columns, §5 MFA), and the phase 2 and 3 designs. Where this differs from `scope.md`, this document wins.

## Intent
Protect accounts with a second factor. Every admin and the super admin must use an authenticator app; everyone else
may opt in. The super admin (`evandro`) has no TOTP today, so their next sign-in, and even their current session, is
forced into enrollment. Losing the phone must never lock the super admin out for good.

## Goals
- TOTP (RFC 6238: SHA-1, 6 digits, 30 s step, accepts the previous/current/next step) with an authenticator app, issuer `KMK Entretien`, account name = username.
- Enrollment with a QR code and a text secret, confirmed by entering a code; then 10 single-use recovery codes, shown once.
- Two-step login for users with TOTP enabled (password, then code or recovery code).
- Enforcement: a role of `admin` or `superadmin` without TOTP can do nothing except enroll, read its own state, and sign out.
- Self-service for everyone: enable, regenerate recovery codes, and (non-admins only) disable.
- A server command that resets anyone's TOTP (the escape hatch).
- TOTP secrets encrypted at rest; codes can't be replayed; code guessing is rate limited; everything audited.

## Non-goals
Admin page and admin-triggered MFA reset for other users (4b), passkeys/WebAuthn, SMS or email codes, "remember this device", encryption-key rotation,
a list of active sessions, changing the TOTP parameters.

## Anti-goals
A TOTP secret, code, or recovery code in logs, audit rows, or API responses other than the one-time enrollment response; an endpoint that forgets to check the MFA state;
a way to reach an admin endpoint with a password alone; revealing that an account has TOTP before its password is verified; a code that works twice.

## Constraints
- Phase 2/3 stack and conventions (kmk_app role, INSERT-only audit log, Origin + per-session CSRF token, real client IP, tests only on `kmk_test`).
- The host clock must be correct (TOTP depends on it); it is a deployment note, not code.
- New runtime dependencies: `pyotp`, `cryptography` (backend); `qrcode` (frontend). Content-Security-Policy already allows `img-src 'self' data:`.
- The encryption key lives in `deploy/.env` (`MFA_ENCRYPTION_KEY`), outside the database, and must be backed up with the database backups: without it every stored secret is unreadable.

## Approaches considered (my calls)
- **How a login becomes two-step:** a separate challenge-token table vs a half-authenticated session. **Pick: a restricted session.** Login always creates a session; `sessions.mfa_verified`
  is false until the code is accepted; one central check (`require_auth`) decides what a session may call. Reuses expiry, revocation, CSRF and cookie handling; the risk (an endpoint forgetting the check) is removed
  by making "fully verified" the default for every endpoint and listing the few exceptions explicitly, with a test that iterates over every route.
- **TOTP implementation:** hand-rolled HMAC vs `pyotp`. **Pick: `pyotp`** (widely used, avoids subtle mistakes).
- **Secret storage:** plaintext, database-side encryption, or application-side Fernet with a key in `.env`. **Pick: Fernet** (`cryptography`); a stolen database dump alone reveals nothing.
- **Recovery codes at rest:** Argon2 vs SHA-256. **Pick: SHA-256 of the normalized code** (50-bit random codes, single use, rate limited; Argon2 per lookup adds cost without real benefit here).
- **Escape hatch:** email-based MFA reset vs a server command. **Pick: the command** (an emailed reset would reduce MFA to the strength of the mailbox).
- **QR code:** rendered in the browser from the `otpauth://` URI, so no image endpoint ever carries the secret.

## Decisions
**Session states** (computed per request, never stored): `ok`; `verify` (the user has TOTP, the session's `mfa_verified` is false); `setup` (role is `admin`/`superadmin`, TOTP not enabled).
`require_auth(request, db, settings, *, csrf, allow=("ok",))` rejects any other state with `403 {"error": "mfa_required"}` (verify) or `403 {"error": "mfa_setup_required"}` (setup).
Allowed exceptions: `/api/auth/me` and `/api/auth/logout` (all states); `/api/auth/mfa/verify` (verify state); `/api/auth/mfa/setup` and `/api/auth/mfa/enable` (setup state, and ok state for voluntary enrollment).
Because the state is computed on every request, the super admin's existing session becomes `setup` the moment this ships.

**Schema (Alembic `0004`, grants to `kmk_app`):**
- `users.mfa_last_step bigint null` (replay protection); `users.mfa_secret` (exists) holds the Fernet token; `users.mfa_enabled` (exists). A secret with `mfa_enabled = false` is a pending enrollment.
- `sessions.mfa_verified boolean not null default true` (existing sessions stay verified).
- `recovery_codes(id, user_id FK, code_hash varchar(64), created_at, used_at null)`, index on `(user_id)` and unique on `code_hash`. Full DML for `kmk_app`.
- `login_attempts.kind` gains `mfa`.

**Login:** after a correct password, a user with `mfa_enabled` gets a session with `mfa_verified = false` and the response says `"mfa": "verify"`; an admin without TOTP gets `"mfa": "setup"`; everyone else `"mfa": "ok"`.
`/api/auth/me` returns the same `mfa` field. Wrong password behaviour is unchanged (the existence-hiding rules from phase 2 still hold).

**Endpoints** (`/api/auth/mfa/...`, CSRF and Origin required, `Cache-Control: no-store`):
- `POST /setup` (409 `already_enabled` if enabled): creates a new pending secret (replacing an older pending one) and returns `{secret, otpauth_uri}`.
- `POST /enable {code}`: checks the code against the pending secret; sets `mfa_enabled`, records the step, creates 10 recovery codes (replacing any), marks the current session verified, revokes the user's other sessions; returns `{recovery_codes: [...]}` once. Wrong code: `403 {"error": "invalid_code"}`.
- `POST /verify {code}` or `{recovery_code}` (verify state): on success sets the session's `mfa_verified`; a recovery code is consumed (`used_at`), and the response includes `recovery_codes_remaining`. Wrong: `403 invalid_code`.
- `POST /disable {password, code}`: non-admins only (admins get `403 {"error": "mfa_mandatory"}`); needs password and a current code; clears secret and recovery codes, revokes other sessions.
- `POST /recovery-codes/regenerate {password, code}`: new set of 10, old ones invalid; returns them once.
All code checks: step must be greater than `mfa_last_step` (atomic `UPDATE ... WHERE mfa_last_step IS NULL OR mfa_last_step < :step`), failures counted under kind `mfa` per user and per IP with the existing limits → `429 too_many_attempts`.

**Recovery codes:** 10 per set, form `xxxxx-xxxxx` from an unambiguous 32-character alphabet, case-insensitive and dash-optional when typed; each works once.

**Encryption:** `app/mfa.py` wraps Fernet (`MFA_ENCRYPTION_KEY` setting, required when any MFA code runs; the app refuses to start MFA endpoints without it and the settings doc explains how to generate one).

**CLI:** `python -m app.cli reset-mfa --username U`: clears secret, `mfa_enabled`, `mfa_last_step`, recovery codes, revokes all the user's sessions, audit `mfa_reset` (actor null, details `via: cli`). An admin reset this way is forced to enroll again at the next sign-in.

**Audit events:** `mfa_enrolled`, `mfa_verified`, `mfa_failed`, `recovery_code_used`, `recovery_codes_regenerated`, `mfa_disabled`, `mfa_reset`. No codes, secrets or hashes in details.

**Frontend:** after login, `mfa` drives the screen: `verify` shows a code field (with "use a recovery code" toggle); `setup` shows the enrollment page (QR code, the secret as text, code field, then the recovery codes with copy/download and an "I saved them" confirmation before continuing); `ok` shows the signed-in page, which gains a security section (enable, regenerate recovery codes, disable for non-admins). All strings in EN, FR-CA and PT-BR.

## Verification the plan must cover
- Every route under `/api` is classified; a test iterates `app.routes` and fails for any route that is neither on the explicit allow-list nor protected by the default verified-state check.
- A password alone never reaches an admin endpoint; an admin without TOTP can only enroll, read `/me`, and log out; an existing session of such an admin is restricted without re-login.
- Codes: accepted within the ±1 step window, rejected outside it; a code can't be used twice (replay); recovery codes work once, case/dash-insensitive; regenerating invalidates the old set; wrong codes are rate limited and audited.
- Enabling TOTP revokes other sessions; disabling is refused for admins; disabling needs password and a code.
- TOTP secrets in the database are Fernet tokens (not the base32 secret); no secret, code or recovery code appears in audit rows or logs.
- `reset-mfa` clears everything and the admin is forced to enroll again.
- The phase 2 and 3 tests that log in as an admin keep working through a test helper that enrolls or verifies TOTP.

## Left to the builder
Module layout, the exact recovery-code alphabet, the QR component, wording of the screens, how the route-classification test enumerates routes, the test helper for admin logins with TOTP, and the `.env` documentation for the key.
