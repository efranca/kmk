# Security model (as implemented)

What protects the app, how, and where the limits are. Tests referred to are in `backend/tests/`.

## Transport and exposure

- Visitors reach the app only through the Cloudflare Tunnel: HTTPS to Cloudflare, an outbound tunnel from this machine. `http://` is redirected to `https://` at Cloudflare. Nothing listens beyond loopback (`127.0.0.1:8081` Caddy, `127.0.0.1:8001` API, `127.0.0.1:5432` Postgres).
- Passwords therefore travel encrypted from the browser to Cloudflare and through the tunnel; the hops on this machine are plain HTTP on loopback. Cloudflare can see traffic in clear text, as any proxying CDN can.
- Response headers set by Caddy: `Strict-Transport-Security` (1 year), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, a strict `Content-Security-Policy` (no inline or external scripts, styles only from the site itself, images from the site and `data:`), and the `Server` header removed. API responses under `/api/auth` and `/api/admin` carry `Cache-Control: no-store`.
- The API documentation pages (`/docs`, `/openapi.json`) are switched off.

## Real client address

Caddy resolves the visitor's address from Cloudflare's `Cf-Connecting-Ip` header (only trusted from the tunnel on loopback) and passes it to the API as `X-Real-Client-Ip`, overwriting anything the client sent.
The API believes that header only when the TCP peer is loopback; anyone else's value is ignored (`app/security.py: client_ip`, tested in `test_auth.py` and `test_security.py`). The address feeds rate limiting, session records and the audit log.

## Passwords

- Argon2id (`argon2-cffi` defaults); hashes are upgraded on login if the parameters age. Rules: at least 8 characters with letters, digits and special characters (`validate_password_rules`). Maximum length 1024 (longer is rejected before hashing).
- Login accepts username or email, case-insensitively. Every failure (wrong password, unknown user, disabled, deleted or not-yet-active account) returns the same `401` body, and an unknown user still costs one Argon2 verification so timing does not reveal accounts.
- Accounts are created only by an admin (invite) or the server command; there is no sign-up.

## Sessions and CSRF

- Server-side sessions, absolute lifetime 5 days. The cookie `kmk_session` is `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/api`. Only the SHA-256 hash of the token is stored.
- A session is valid only if not revoked, not expired, and its user is `active`. Sessions are revoked on logout, password reset, password change (all others), enabling or disabling two-step verification (all others), and by `reset-mfa` (all).
- CSRF has three layers: the strict cookie, an `Origin` check on every mutating `/api` request (must be in `allowed_origins`), and a per-session token (HMAC of the session hash with `SESSION_SECRET`) sent as `X-CSRF-Token` on authenticated mutating requests.

## Rate limiting

Failed attempts are stored in `login_attempts` by kind and counted over 15 minutes, per IP and per submitted identifier. Defaults: 10 per IP, 5 per identifier, then `429 too_many_attempts`.
Kinds: `login` (sign-in and wrong current password on change), `reset_request` (every forgot-password request counts), `token` (bad invite/reset links; keyed by IP, so effectively 5 per IP), `mfa` (wrong codes or passwords on the two-step endpoints, per username).
Counting uses the submitted identifier whether or not the account exists, so the limiter does not reveal accounts.

## Invite and reset links

- 32 random bytes, stored only as SHA-256; invite valid 48 hours, reset 30 minutes; single use (redeemed with one atomic `UPDATE ... RETURNING`, so concurrent use has one winner); issuing a new one cancels older unused ones of the same purpose.
- The token is in the URL fragment (`/set-password#token=...`), so it is never sent to the server, Caddy logs or Referer headers; the page removes it from the address bar at once.
- `forgot-password` always answers `202 {"status":"ok"}`; email is sent after the response so timing does not leak. A new password is validated before the token is spent. A reset revokes all of the user's sessions; accepting an invite does not sign anyone in.
- All bad links return one generic `400 invalid_token`.

## Two-step verification (TOTP)

- RFC 6238 (SHA-1, 6 digits, 30 s step; the previous, current and next step are accepted). Secrets are encrypted with Fernet using `MFA_ENCRYPTION_KEY` (kept in `.env`, not in the database). A used code cannot be reused (the accepted time step is stored and must increase, updated atomically).
- Recovery codes: 10 per set, 50 random bits each, stored as SHA-256 of the normalized code, single use; regenerating replaces the set. Codes are shown once.
- A login always creates a session. For a user with TOTP the session starts unverified (`sessions.mfa_verified = false`) and may only read `/me`, sign out, and call `/api/auth/mfa/verify`. One guard (`auth/guard.py`) enforces the state on every protected route, before request validation; `test_mfa_guard.py` calls every route in the API description with an unverified session to prove no route is missed.
- States: `ok`, `verify`, `setup`. `setup` applies only to roles listed in `MFA_REQUIRED_ROLES` without TOTP (empty by default: **two-step verification is encouraged, not forced**).
- Disabling or regenerating needs the password and a current code. If the phone is lost, the server command `reset-mfa` clears it; there is deliberately no email-based reset (it would make TOTP only as strong as the mailbox).

## Administration: authority and account lifecycle

**Authority** is decided in one module, `backend/app/auth/policy.py`, and enforced by the server on every admin endpoint (the page only shows what the server lists). Checks run in this order: the actor must be an admin or the super admin; nobody may disable, delete, change the role of, or reset the two-step verification of **themselves**; then the matrix:

| Actor | May act on | Notes |
| --- | --- | --- |
| super admin | `user` and `admin` accounts | everything; role changes only between `user` and `admin`; never creates a second super admin (that is the server command) |
| admin | `user` accounts only | invite (role `user`), edit, resend invite, reset password, reset two-step, disable, enable, delete, restore; cannot change roles |
| anyone | the super admin account | nothing, except the super admin's own password reset |
| plain user | nobody | no admin powers |

**This overrides `scope.md` section 6**, which let admins demote or delete other admins. Here only the super admin manages admins, because two-step verification is optional and one stolen admin password must not be able to remove every other admin.

**State machine** (`users.status`, in `lifecycle.py`): disable: `invited`/`active` to `disabled`; enable: `disabled` to `active` (or back to `invited` if the person never set a password); delete: any non-deleted state to `deleted` (sets `deleted_at`, voids unused invite/reset links); restore: `deleted` to `disabled` (an admin then enables it). A wrong source state answers `409 invalid_state`.
A deleted account keeps its username and email reserved (nothing new can take them); restoring is the way to bring someone back.

**Admins and their own password:** an admin or the super admin changes their password on the signed-in page (needs the current password) or recovers it with the ordinary "forgot password" link, exactly like anyone else; a reset never bypasses two-step verification (an account with TOTP still asks for a code at the next sign-in). The admin page's "reset password" action is for other people's accounts (the super admin may also use it on themselves).

**Session effects:** disabling, deleting, changing the role of, or resetting the two-step verification of an account signs all of that account's sessions out at once. A disabled or deleted user cannot sign in (the generic `401`).

**Last-admin invariant:** demoting, disabling or deleting an active admin or super admin is refused (`409 last_admin`) if no other active admin or super admin would remain; the privileged rows are locked in the same transaction, so two simultaneous requests cannot both succeed (tested with a race). Because the super admin is untouchable and always active, this cannot trigger through the API today; it is a safety net.

**Edit rules:** the language can change at any time; the email only while the account is still `invited` (to fix a typo before the person accepts). The page's "last sign-in" comes from the `sessions` table because the app cannot read the audit log.

## Audit log

`audit_log` is append-only at the database level: the runtime role `kmk_app` has INSERT but no SELECT, UPDATE or DELETE on it. Events written: `login_success`, `login_failed`, `login_rate_limited`, `logout`, `user_created`, `user_invited`, `invite_resent`,
`password_reset_requested`, `invite_accepted`, `password_reset_completed`, `password_changed`, `email_failed`, `mfa_enrolled`, `mfa_verified`, `mfa_failed`, `recovery_code_used`, `recovery_codes_regenerated`, `mfa_disabled`, `mfa_reset` (by the server command or by an admin), `user_disabled`, `user_enabled`, `user_deleted`, `user_restored`, `user_role_changed` (with the old and new role), `user_updated` (field names only, never values such as email addresses).
Details never contain passwords, hashes, tokens, links, TOTP secrets, codes or recovery codes (tests scan audit rows and logs for them). There is no viewer yet; read it with `psql` as the superuser.

## Secrets

Only in git-ignored `.env` files with mode 600: database passwords, `SESSION_SECRET`, `RESEND_API_KEY`, `MFA_ENCRYPTION_KEY`. The Docker image does not contain them (they are passed at run time). The development email backend (`log`) prints full messages, links included, to the API log, so it must not be used once real users exist.

## Accepted risks and known limits

- Someone can lock a colleague out of sign-in for up to 15 minutes by submitting that username repeatedly (limits are per identifier).
- One machine hosts everything; the Postgres server is shared with other projects (they cannot read the `kmk` data without its role passwords, but share the server's availability and its superuser).
- Any process on the host can reach the loopback ports; the API still authenticates every request.
- Losing `MFA_ENCRYPTION_KEY` makes stored TOTP secrets unusable (recovery: `reset-mfa` per user). There is no key rotation yet.
- A compromised super admin session could do anything an admin can, and more; two-step verification is optional for now. A compromised admin session can disable or delete plain users (not admins).
- The password policy is 8 characters with a mix (from the plan); a breached-password check and a longer minimum are deferred.

## Not covered yet

An audit log viewer, a tested restore procedure, dependency vulnerability scanning in the build, an independent security review, privacy-law review (PIPEDA, Quebec Law 25, LGPD) before real customer data is stored. See the [roadmap](roadmap.md).
