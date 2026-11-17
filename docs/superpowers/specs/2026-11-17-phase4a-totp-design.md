# Phase 4a (TOTP): two-step login, enrollment, recovery codes, encouraged (not forced)

Phase 4 is split in two (user's choice, on my recommendation): **4a** (this document) is TOTP; **4b** is the admin page,
user lifecycle endpoints (disable, delete, role change, admin-triggered MFA reset) and role rules, designed after 4a ships.
Builds on `scope.md` (§4 users columns, §5 MFA) and the phase 2 and 3 designs. Where this differs from `scope.md`, this document wins.

**Scope change (user, during design):** `scope.md` makes TOTP mandatory for admins. For now it is **encouraged, not forced**.
The enforcement machinery is still built, switched off by a setting, so turning it on later is a configuration change.

## Intent
Offer a second factor to everyone and nudge people toward it, admins most of all, without locking anyone out while the
team is still being onboarded. Anyone who turns TOTP on gets full two-step login; recovering from a lost phone is possible
without touching the database by hand.

## Goals
- TOTP (RFC 6238: SHA-1, 6 digits, 30 s step, accepts the previous/current/next step) with an authenticator app, issuer `KMK Entretien`, account name = username.
- Enrollment with a QR code and a text secret, confirmed by entering a code; then 10 single-use recovery codes, shown once.
- Two-step login for users who enabled TOTP (password, then a code or a recovery code).
- Encouragement: a banner on the signed-in page for anyone without TOTP (permanent for admins and the super admin, dismissible per browser for others).
- Self-service for everyone: enable, regenerate recovery codes, disable (needs password and a code).
- **Enforcement switch:** setting `MFA_REQUIRED_ROLES` (comma-separated roles, default empty = nobody is forced). A listed role without TOTP can only enroll, read `/me`, and sign out, and cannot disable TOTP.
  Setting it to `admin,superadmin` later implements the original `scope.md` rule with no code change.
- A server command that resets anyone's TOTP (the escape hatch for a lost phone).
- TOTP secrets encrypted at rest; codes can't be replayed; code guessing is rate limited; everything audited.
- **Project documentation** (see below), so the work can be picked up later by someone (or a future session) who was not here.

## Non-goals
Admin page and admin-triggered MFA reset for other users (4b), passkeys/WebAuthn, SMS or email codes, "remember this device",
encryption-key rotation, a list of active sessions, changing the TOTP parameters, making MFA mandatory (a later switch, see above).

## Anti-goals
A TOTP secret, code, or recovery code in logs, audit rows, or API responses other than the one-time enrollment response; an endpoint that forgets to check the MFA state;
revealing that an account has TOTP before its password is verified; a code that works twice; documentation that describes how things were meant to work instead of how they do.

## Constraints
- Phase 2/3 stack and conventions (kmk_app role, INSERT-only audit log, Origin + per-session CSRF token, real client IP, tests only on `kmk_test`).
- The host clock must be correct (TOTP depends on it); a deployment note, not code.
- New runtime dependencies: `pyotp`, `cryptography` (backend); `qrcode` (frontend). The Content-Security-Policy already allows `img-src 'self' data:`.
- The encryption key lives in `deploy/.env` (`MFA_ENCRYPTION_KEY`), outside the database, and must be backed up with the database backups: without it every stored secret is unreadable. `pg-backup.sh` does not cover `.env`, so the documentation must say so.

## Approaches considered (my calls unless noted)
- **Enforcement:** forced for admins (original scope) vs encouraged only vs encouraged with a switch. **User: encouraged, not forced. Pick: encouraged with the `MFA_REQUIRED_ROLES` switch** (tested in both positions).
- **How a login becomes two-step:** a separate challenge-token table vs a half-authenticated session. **Pick: a restricted session.** Login always creates a session; `sessions.mfa_verified`
  is false until the code is accepted; one central guard decides what a session may call. Reuses expiry, revocation, CSRF and cookie handling. The risk (an endpoint forgetting the check) is removed
  by making "fully verified" the default guard for every protected route and listing the few exceptions explicitly, with a test that exercises every route.
- **TOTP implementation:** hand-rolled HMAC vs `pyotp`. **Pick: `pyotp`**.
- **Secret storage:** plaintext, database-side encryption, or application-side Fernet with a key in `.env`. **Pick: Fernet** (`cryptography`); a stolen database dump alone reveals nothing.
- **Recovery codes at rest:** Argon2 vs SHA-256. **Pick: SHA-256 of the normalized code** (50-bit random codes, single use, rate limited).
- **Escape hatch:** email-based MFA reset vs a server command. **Pick: the command** (an emailed reset would reduce MFA to the strength of the mailbox).
- **QR code:** rendered in the browser from the `otpauth://` URI, so no image endpoint ever carries the secret.

## Decisions
**Session states** (computed per request, never stored): `ok`; `verify` (the user has TOTP and the session's `mfa_verified` is false); `setup` (the user's role is in `MFA_REQUIRED_ROLES` and TOTP is not enabled; never occurs while the setting is empty).
Every protected route is guarded by one dependency, `guard(allow=("ok",), csrf=...)`, which returns `(user, session)` and rejects other states with `403 {"error": "mfa_required"}` (verify) or `403 {"error": "mfa_setup_required"}` (setup).
It runs as a FastAPI dependency, so it fires before request-body validation. Exceptions, declared explicitly: `/api/auth/me` and `/api/auth/logout` (all states); `/api/auth/mfa/verify` (verify); `/api/auth/mfa/setup` and `/api/auth/mfa/enable` (ok and setup).
Public routes (no session): health, login, forgot-password, set-password.

**Schema (Alembic `0004`, grants to `kmk_app`):**
- `users.mfa_last_step bigint null` (replay protection); `users.mfa_secret` (exists) holds the Fernet token; `users.mfa_enabled` (exists). A secret with `mfa_enabled = false` is a pending enrollment.
- `sessions.mfa_verified boolean not null default true` (existing sessions stay verified).
- `recovery_codes(id, user_id FK, code_hash varchar(64) unique, created_at, used_at null)`, index on `user_id`. Full DML for `kmk_app`.
- `login_attempts.kind` gains `mfa`.

**Login:** after a correct password, a user with TOTP enabled gets a session with `mfa_verified = false`. The login and `/me` responses carry `"mfa": "ok" | "verify" | "setup"` and `"mfa_enabled": bool`.
Wrong-password behaviour is unchanged (the existence-hiding rules from phase 2 hold); TOTP status is only revealed after the password is verified.

**Endpoints** (`/api/auth/mfa/...`, CSRF and Origin required, `Cache-Control: no-store`):
- `POST /setup` (409 `already_enabled` if enabled): creates a new pending secret (replacing an older pending one), returns `{secret, otpauth_uri}`.
- `POST /enable {code}`: checks the code against the pending secret; sets `mfa_enabled`, records the step, creates 10 recovery codes (replacing any), marks the current session verified, revokes the user's other sessions; returns `{recovery_codes: [...]}` once. Wrong code: `403 {"error": "invalid_code"}`.
- `POST /verify {code}` or `{recovery_code}` (verify state): success sets the session's `mfa_verified`; a recovery code is consumed and the response includes `recovery_codes_remaining`. Wrong: `403 invalid_code`.
- `POST /disable {password, code}`: refused with `403 {"error": "mfa_mandatory"}` when the user's role is in `MFA_REQUIRED_ROLES`; needs password and a current code; clears secret and recovery codes, revokes other sessions.
- `POST /recovery-codes/regenerate {password, code}`: a new set of 10, the old ones become invalid; returned once.
All code checks: the time step must be greater than `mfa_last_step` (atomic conditional update); failures are counted under kind `mfa` per user and per IP with the existing limits, then `429 too_many_attempts`.

**Recovery codes:** 10 per set, form `xxxxx-xxxxx` from an unambiguous 32-character alphabet; case-insensitive and dash-optional when typed; each works once.

**Encryption:** a small module wraps Fernet with `MFA_ENCRYPTION_KEY`. Without the key the MFA endpoints answer `503 {"error": "mfa_unavailable"}` and the rest of the app works.

**CLI:** `python -m app.cli reset-mfa --username U` clears secret, `mfa_enabled`, `mfa_last_step`, recovery codes, revokes all the user's sessions, audit `mfa_reset` (actor null, `via: cli`).

**Audit events:** `mfa_enrolled`, `mfa_verified`, `mfa_failed`, `recovery_code_used`, `recovery_codes_regenerated`, `mfa_disabled`, `mfa_reset`. No codes, secrets or hashes in details.

**Frontend:** the `mfa` field drives the screen: `verify` shows a code field (with a "use a recovery code" toggle); `setup` (only when enforcement is on) and the voluntary "Enable two-step verification" action open the enrollment page (QR, secret as text, code field, then the recovery codes with copy and an "I saved them" confirmation before continuing);
`ok` shows the signed-in page with the nudge banner and a security section (enable, regenerate codes, disable). Strings in EN, FR-CA and PT-BR.

## Documentation deliverable (part of this phase)
The repository gets a documentation set written from the code as it is, reviewed against the running system, so a person or a future session can resume without this conversation:
- `README.md` (root): what the project is, live URL, where things are, how to run tests, where the docs are.
- `CLAUDE.md` (root): conventions and commands for future coding sessions (layout, how to test, how to deploy, rules about secrets, where specs and plans live).
- `docs/README.md`: index, architecture overview, phase status table (done / next), pointers to every spec and plan.
- `docs/operations.md`: runbook: deploy and rebuild, the environment variables (each one explained), database roles and migrations, CLI commands, backups and the encryption key, switching email to Resend, enabling MFA enforcement, common failures.
- `docs/security.md`: the security model as implemented: authentication, sessions, CSRF, rate limits, audit log, tokens, MFA, what is deliberately not protected, known accepted risks.
- `docs/roadmap.md`: what is next (4b, 5, 6), deferred items, parked risks from `scope.md` §12, open items, and the switches that are built but off.

## Verification the plan must cover
- A route test: every route under `/api` is either on the explicit public list, on the explicit exceptions list, or answers `403 mfa_required` to a `verify`-state session (checked with the CSRF header and Origin, and an empty body, so the guard fires before validation).
- With the default settings an admin without TOTP works normally (nothing is forced). With `mfa_required_roles=admin,superadmin` that admin can only enroll, read `/me`, and sign out, and cannot disable TOTP.
- Codes: accepted within the ±1 step window, rejected outside it; replay rejected; recovery codes work once, case/dash-insensitive; regenerating invalidates the old set; wrong codes are rate limited and audited.
- Enabling TOTP revokes other sessions; disabling needs password and a code; secrets in the database are Fernet tokens, not the base32 secret; no secret, code or recovery code in audit rows or logs.
- `reset-mfa` clears everything. Without `MFA_ENCRYPTION_KEY` the MFA endpoints answer `503` and login still works for users without TOTP.
- Documentation accuracy: every command, port, variable and path written in the docs is exercised or checked against the repo before the phase is declared done.

## Left to the builder
Module layout, the exact recovery-code alphabet, the QR component, wording of the screens and banner, how the route test enumerates routes, the final shape of the documents (within the list above).
