# Security model (as implemented)

What protects the app, how, and where the limits are. Tests referred to are in `backend/tests/`. What was checked, and the independent review that found and fixed several weaknesses, is recorded in [security-review.md](security-review.md).

## Transport and exposure

- Visitors reach the app only through the Cloudflare Tunnel: HTTPS to Cloudflare, an outbound tunnel from this machine. `http://` is redirected to `https://` at Cloudflare. Nothing listens beyond loopback (`127.0.0.1:8081` Caddy, `127.0.0.1:8001` API, `127.0.0.1:5432` Postgres).
- Passwords therefore travel encrypted from the browser to Cloudflare and through the tunnel; the hops on this machine are plain HTTP on loopback. Cloudflare can see traffic in clear text, as any proxying CDN can.
- Response headers set by Caddy: `Strict-Transport-Security` (1 year), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, a strict `Content-Security-Policy` (no inline or external scripts, styles only from the site itself, images from the site and `data:`), and the `Server` header removed. API responses under `/api/auth` and `/api/admin` carry `Cache-Control: no-store`.
- The API documentation pages are switched off (`/api/docs`, `/api/redoc`, `/api/openapi.json` answer `404`).
- API request bodies are limited to 64 KB at the proxy (`413` beyond): every API call is tiny JSON.
- The two kmk containers drop all Linux capabilities (Caddy keeps only the one it needs to start), cannot gain privileges, and have memory and process limits; the API container runs as a non-root user.

## Real client address

Caddy resolves the visitor's address from Cloudflare's `Cf-Connecting-Ip` header (only trusted from the tunnel on loopback) and passes it to the API as `X-Real-Client-Ip`, overwriting anything the client sent.
The API believes that header only when the TCP peer is loopback; anyone else's value is ignored (`app/security.py: client_ip`, tested in `test_auth.py` and `test_security.py`). The address feeds rate limiting, session records and the audit log.
In production the server (uvicorn) also applies its own standard proxy-header handling (`X-Forwarded-For`, trusted from loopback), so two mechanisms lead to the visitor's address; a live probe with a forged `X-Real-Client-Ip` recorded the true address (see [security-review.md](security-review.md)). The reviewer recommends making the documented header the only mechanism (`--no-proxy-headers`); this is recorded as a deferred minor.

## Passwords

- The password is sent as typed, protected by HTTPS (it is visible in the user's own browser tools, which is normal); why it is not encrypted again in the browser, and the passkey option, are in [decisions.md](decisions.md) (D1, D2).
- Argon2id (`argon2-cffi` defaults); hashes are upgraded on login if the parameters age. Each Argon2 call uses 64 MiB, so at most 4 run at once (the rest wait) to bound memory under a burst. Rules: at least 8 characters with letters, digits and special characters (`validate_password_rules`). Maximum length 1024 (longer is rejected before hashing).
- Login accepts username or email, case-insensitively. Every failure (wrong password, unknown user, disabled, deleted or not-yet-active account) returns the same `401` body, and an unknown user still costs one Argon2 verification so timing does not reveal accounts.
- Accounts are created only by an admin (invite) or the server command; there is no sign-up.

## Sessions and CSRF

- Server-side sessions, absolute lifetime 5 days. The cookie `kmk_session` is `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/api`. Only the SHA-256 hash of the token is stored.
- A session is valid only if not revoked, not expired, and its user is `active`. Sessions are revoked on logout, password reset, password change (all others), enabling or disabling two-step verification (all others), and by `reset-mfa` (all).
- CSRF has three layers: the strict cookie, an `Origin` check on every mutating `/api` request (must be in `allowed_origins`), and a per-session token (HMAC of the session hash with `SESSION_SECRET`) sent as `X-CSRF-Token` on authenticated mutating requests.

A person changes their own language with `POST /api/auth/locale`, protected like every account change (verified session, CSRF token, allowed Origin); it cannot be used on anyone else.

## Rate limiting

Failed attempts are stored in `login_attempts` by kind and counted over 15 minutes, per source address and per submitted identifier. Defaults: 10 per address, 5 per identifier, then `429 too_many_attempts`.
An IPv6 address counts as its whole /64 (one customer's allocation). Attempts for the same address and the same identifier are serialized with database advisory locks, so a burst of parallel requests cannot get more tries than the limit allows (tested with simultaneous requests on login and on the two-step endpoints).
A username and an email address for the same account are counted as separate identifiers, so one account can see up to 10 guesses per window (deferred minor). When a limit is first reached one `login_rate_limited` audit row is written; further limited requests write nothing.
Kinds: `login` (sign-in and wrong current password on change), `reset_request` (every forgot-password request counts), `token` (bad invite/reset links; keyed by address, so effectively 5 per address), `mfa` (wrong codes or passwords on the two-step endpoints, per username).
Counting uses the submitted identifier whether or not the account exists, so the limiter does not reveal accounts.

## Invite and reset links

- 32 random bytes, stored only as SHA-256; invite valid 48 hours, reset 30 minutes; single use (redeemed with one atomic `UPDATE ... RETURNING`, so concurrent use has one winner); issuing a new one cancels older unused ones of the same purpose, and so does correcting an invited person's email address (the first link went to the old address).
- The token is in the URL fragment (`/set-password#token=...&lang=...`), so it is never sent to the server, Caddy logs or Referer headers; the page removes the whole fragment from the address bar at once. The `lang` part is the recipient's language (not secret); the page uses it only if it is one of the three supported languages.
- `forgot-password` always answers `202 {"status":"ok"}`; the email is sent after the response (a few milliseconds of difference remain for an existing active account, because the token is created within the request; deferred minor). A new password is validated before the token is spent. A reset revokes all of the user's sessions; accepting an invite does not sign anyone in.
- All bad links return one generic `400 invalid_token`.
- **What the email shows:** the token still has to be in the link (it is how the link proves who you are), but the HTML part shows words ("Choisir mon mot de passe") with the long address behind them, and names the site as a link to `https://app.kmk-entretien.ca`. The plain-text part cannot hide an address, so it keeps the full link. The token stays in the URL fragment either way, so it never reaches server logs or Referer headers. The email signs off "KMK Entretien".

## Two-step verification (TOTP)

- RFC 6238 (SHA-1, 6 digits, 30 s step; the previous, current and next step are accepted). Secrets are encrypted with Fernet using `MFA_ENCRYPTION_KEY` (kept in `.env`, not in the database). A used code cannot be reused (the accepted time step is stored and must increase, updated atomically).
- Recovery codes: 10 per set, about 50 bits each (10 characters from a 31-character alphabet), stored as unsalted SHA-256 of the normalized code, single use; regenerating replaces the set. Codes are shown once. Online guessing is stopped by the rate limit; a copy of the database would allow offline guessing of these codes (a keyed hash is a deferred improvement, cheapest before anyone enrolls).
- A login always creates a session. For a user with TOTP the session starts unverified (`sessions.mfa_verified = false`) and may only read `/me`, sign out, and call `/api/auth/mfa/verify`. One guard (`auth/guard.py`) enforces the state on every protected route, before the request body is validated (bodies are capped at 64 KB at the proxy); `test_mfa_guard.py` calls every route in the API description with an unverified session to prove no route is missed.
- States: `ok`, `verify`, `setup`. `setup` applies only to roles listed in `MFA_REQUIRED_ROLES` without TOTP (empty by default: **two-step verification is encouraged, not forced**).
- Disabling or regenerating needs the password and a current code. If the phone is lost, the server command `reset-mfa` clears it; there is deliberately no email-based reset (it would make TOTP only as strong as the mailbox).

## Administration: authority and account lifecycle

**Authority** is decided in one module, `backend/app/auth/policy.py`, and enforced by the server on every admin endpoint (the page only shows what the server lists). Checks run in this order: the actor must be an admin or the super admin; nobody may disable, delete, change the role of, or reset the two-step verification of **themselves**; then the matrix:

| Actor | May act on | Notes |
| --- | --- | --- |
| super admin | `user` and `admin` accounts, and **their own account for edits** | everything; role changes only between `user` and `admin`; may fix anyone's name and language, including their own; never creates a second super admin (that is the server command) |
| admin | `user` accounts only | invite (role `user`), edit, resend invite, reset password, reset two-step, disable, enable, delete, restore; cannot change roles |
| anyone | the super admin account | nothing, except the super admin's own password reset and own edits (name, language) |
| admin or super admin | their own account | reset their own password only (never disable, delete, change role or reset two-step on themselves) |
| plain user | nobody | no admin powers |

**This overrides `scope.md` section 6**, which let admins demote or delete other admins. Here only the super admin manages admins, because two-step verification is optional and one stolen admin password must not be able to remove every other admin.

**State machine** (`users.status`, in `lifecycle.py`): disable: `invited`/`active` to `disabled`; enable: `disabled` to `active` (or back to `invited` if the person never set a password); delete: any non-deleted state to `deleted` (sets `deleted_at`, voids unused invite/reset links); restore: `deleted` to `disabled` (an admin then enables it). A wrong source state answers `409 invalid_state`.
A deleted account keeps its username and email reserved (nothing new can take them); restoring is the way to bring someone back.

**Admins and their own password:** an admin or the super admin can change their password on the signed-in page (needs the current password), recover it with the ordinary "forgot password" link, or use "reset password" on their own row of the admin page (which emails them a reset link). A reset never bypasses two-step verification: an account with TOTP still asks for a code at the next sign-in.

**Recovering a taken-over account:** an admin may reset the password of a **disabled** account. The emailed link sets the new password but does **not** enable the account; the order is therefore: disable (the attacker is locked out and signed out), reset two-step verification if needed, reset password, the real owner sets a new password through the link, and only then the admin enables the account. The attacker's old password never works again.

**Session effects:** disabling, deleting, changing the role of, or resetting the two-step verification of an account signs all of that account's sessions out at once. A disabled or deleted user cannot sign in (the generic `401`).

**Last-admin invariant:** demoting, disabling or deleting an active admin or super admin is refused (`409 last_admin`) if no other active admin or super admin would remain; the privileged rows are locked in the same transaction, so two simultaneous requests cannot both succeed (tested with a race). Because the super admin is untouchable and always active, this cannot trigger through the API today; it is a safety net.

**Edit rules:** the name and the language can change at any time (not on deleted accounts); the email only while the account is still `invited` (to fix a typo before the person accepts). The page's "last sign-in" comes from the `sessions` table because the app cannot read the audit log.

## Schedule: who sees and who changes events

- **Everyone who is signed in (fully verified) sees every event in full**: title, notes, people and times. This was the owner's choice. Anything written in an event is visible to every employee, so titles and notes must not hold what only some employees should read (for example a client's address or door code).
- **Who may edit or delete an event** is decided in `backend/app/auth/policy.py` (`can_change_event`): admins and the super admin; the person who created it; a person it is for. An event for everyone can be changed only by its creator or an admin. Whoever may change an event may do everything to it, including deleting a whole series or removing the other people; the audit log records who did it. Anyone can create events for themselves or others.
- Only active accounts can be newly put on an event. People already on an event stay on it, and the event stays editable, when their account is later disabled or deleted; they show as a muted face (`GET /api/schedule/people` flags them `active: false`). When a series is split ("this and following") the new series keeps the original creator.
- Creates, changes and deletes are audit-logged (`event_created`, `event_updated`, `event_deleted`) with the event id, the scope and the names of the fields that changed, **never the notes or title text**.
- Reads need a verified session but no CSRF token (like the admin list); changes need both. Responses under `/api/schedule` are `Cache-Control: no-store`.

## Documents

One function (`app/documents/visibility.py`) decides which levels a role may see, and it is applied **inside the SQL `WHERE`** of every read (list, one document, its file), never after loading. A document someone may not see answers `404`, identical to a missing one, so its existence does not leak (titles never reach a person who cannot see the document). Writes need an admin or the super admin (`policy.check_documents`), and nobody can set or edit a level above their own. Files are accepted only as the kinds listed in `files.py` (images, PDF, text, RTF, Office), decided by their contents: signatures for binaries, a real package with the right inner files for Office (a renamed zip is refused), and for text a UTF-8 check without binary bytes plus the extension (text has no signature); the declared type is ignored. Never accepted: archives, programs, scripts, HTML, SVG (active content). Text is always sent as `text/plain`, and Office, RTF, HEIC and TIFF are always downloads (`attachment`). A document's small preview picture (JPEG only, at most 100 KB, made by the browser) follows the same visibility rule as its file, capped while being read (declared length and running total), and served with the verified content type, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox`, `Cache-Control: private, no-store` and an escaped `Content-Disposition`. Audit rows (`document_added`, `document_updated`, `document_replaced`, `document_deleted`, `document_visibility_changed`, `document_category_*`) carry ids and changed field names, never a title, note or file name; downloads are not audited. The files are **not encrypted in the database** (the encrypted backups cover copies); anyone with a database dump of the live server has them. A document shared with "Everyone" is readable by every signed-in person. Known browser caveat to check after the first deploy: Chrome may refuse to show an inline PDF under `Content-Security-Policy: sandbox`; Download always works.

## Connected devices

Only the super admin can list or end sessions (`policy.check_super_admin`; admins and users get `403`, the half-authenticated test covers the routes). The list shows each session's public uuid, never `token_hash` or the cookie. Ending a session sets `revoked_at`, so the cookie stops working on the next request; there is no "block this device" (anyone with the password can sign in again, and a device cannot be reliably identified), so the page says to reset the password or disable the account as well. Location comes only from Cloudflare headers copied by Caddy, believed only from a trusted proxy peer and sanitized. If the "Add visitor location headers" transform is off, a browser could send its own `Cf-Ipcity` through Cloudflare, so the place is shown as approximate and never used for a decision. Audit rows `session_revoked` and `sessions_revoked_all` carry the actor and the person affected, never an address or browser string. Addresses and places stay on this server.

## Audit log

`audit_log` is append-only at the database level: the runtime role `kmk_app` has INSERT but no SELECT, UPDATE or DELETE on it, and the running API does not hold the database owner's credentials (migrations run in a separate one-shot container), so a compromise of the API process cannot erase audit rows. Events written: `login_success`, `login_failed`, `login_rate_limited`, `logout`, `document_added`, `document_updated`, `document_replaced`, `document_deleted`, `document_visibility_changed`, `document_category_created`, `document_category_updated`, `document_category_deleted`, `session_revoked`, `sessions_revoked_all`, `user_created`, `user_invited`, `invite_resent`,
`password_reset_requested`, `invite_accepted`, `password_reset_completed`, `password_changed`, `email_failed`, `mfa_enrolled`, `mfa_verified`, `mfa_failed`, `recovery_code_used`, `recovery_codes_regenerated`, `mfa_disabled`, `mfa_reset` (by the server command or by an admin), `user_disabled`, `user_enabled`, `user_deleted`, `user_restored`, `user_role_changed` (with the old and new role), `user_updated` (field names only, never values such as email addresses), `locale_changed` (a person changing their own language, with the old and new value).
Details never contain passwords, hashes, tokens, links, TOTP secrets, codes or recovery codes (tests scan audit rows and logs for them). The login name someone typed is recorded only when it names a real account (people paste passwords into that box); otherwise only `{"known": false}`. There is no viewer yet; read it with `psql` as the superuser.

## Tasks: who sees and who changes them

- **Everyone who is signed in (fully verified) sees every task in full**, like events: title, description, people, due date. Anything written in a task is visible to every employee.
- **Who may edit or delete a task** is decided in `backend/app/auth/policy.py` (`can_change_task`): admins and the super admin; the person who created it; a person it is for. A task for the whole team (no people) can be edited only by its creator or an admin, but **anyone may complete, start or reopen it** (`can_set_task_status`). Whoever may edit a task may change everything on it, including its people.
- **Categories:** anyone can add one; only admins and the super admin rename, re-icon or delete one (`can_manage_task_categories`). Deleting a category keeps its tasks.
- Only active accounts can be newly put on a task; people already on it stay when their account is later disabled (muted face).
- "Clear completed" deletes only the completed tasks the caller may delete.
- Completing a task takes a row lock, so two people ticking at once cannot overwrite who finished it or when.
- Writes are audit-logged: `task_created`, `task_updated` (with the names of the fields that changed), `task_completed`, `task_started`, `task_reopened`, `task_deleted`, `tasks_cleared` (a count), `task_category_created`, `task_category_updated`, `task_category_deleted`; **never a title, description or category name**.
- Reads need a verified session but no CSRF token; changes need both. Responses under `/api/tasks` are `Cache-Control: no-store`.

## Profile pictures and preferences

- A picture is stored in the database (so the encrypted backups cover it), at most 50 KB. The browser crops it square and re-draws it as a 256 px JPEG, which also drops anything that is not pixels. The server still checks: the type comes from the first bytes of the body (JPEG, PNG or WebP; the declared type and file name are ignored), the size is capped while reading, and anything else is `422 invalid_image`. The database also enforces the type and size.
- It is served only to signed-in, fully verified people, as an image only: the stored content type, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox; default-src 'none'`, `Cache-Control: private, max-age=0, must-revalidate` and an `ETag`.
- Only you can put up your picture. An administrator can take one down with the same authority they need to edit that person (the super admin for admins). Audit actions `avatar_set` and `avatar_removed` carry no content.
- Preferences are a closed schema (a fixed list of keys and values, strict types), kept as one JSON object on the user row. They are never sent in admin lists. They hold no secrets.

## Secrets

Only in git-ignored `.env` files with mode 600: database passwords, `SESSION_SECRET`, `RESEND_API_KEY`, `MFA_ENCRYPTION_KEY`. The Docker image does not contain them (they are passed at run time). The compose file gives each container only the variables it needs: the database **owner's** URL reaches only the one-shot `migrate` container, never the long-running API. The development email backend (`log`) prints full messages, links included, to the API log, so it must not be used once real users exist.

## Names are personal information

Each person has a display name. It is shown to the person themselves (greeting, account page) and to admins (the user list); regular users cannot see other people. It is never written to audit details (a name edit records only that the `name` field changed), error messages or normal logs; emails carry it only in the body, escaped, never in a subject or header.
(The development email backend, `EMAIL_BACKEND=log`, prints whole messages, so with it the greeting appears in the API log: it must not be used with real people, as already noted for links.) The name is validated (1-100 characters: letters, digits, spaces, apostrophes, hyphens, periods; no markup, line breaks or invisible characters), and the database enforces the length as a second check.
Deleting an account is soft, so a deleted person's name stays in the database and in the encrypted backups; an erasure feature does not exist yet and belongs to the privacy review before customer data is stored.

## Backups

Daily encrypted backups of the `kmk` database and a copy of `deploy/.env` (which holds the keys that the database does not) are written to `/mnt/shared/BACKUPS/kmk` by `deploy/backup/` (see [operations.md](operations.md)).
- **Encrypted with a public key:** the unattended job holds only the public key; the private key and its passphrase are kept by the owner in a password manager, never on this computer. Anyone who gets the archives without the private key sees nothing.
- **Verified every run:** the dump is restored into a scratch database and compared with the source; a failure is recorded and shown as a desktop notification, and a status command reports the last result and its age.
- **Guards:** the job refuses to run unless `/mnt/shared` is really mounted (otherwise it would fill the system disk), plaintext is kept in memory-backed storage and removed on exit, retention goes by file name (not by modification time) and never deletes the new file, and a restore only trusts archives whose hash was recorded by the backup on the Linux disk (so an archive dropped onto the shared partition is not executed).
- **Known limit:** the destination is a partition on the same SSD as the system and is readable from Windows; it protects against mistakes, a reinstall and filesystem damage, not against the SSD failing or being stolen. An off-site copy is a future step.
- Memory-backed storage can be swapped to disk by the operating system, and the restore's extract option writes plaintext files (mode 600) where the owner asks; both are the owner's to clean up.

## Accepted risks and known limits

- Someone can lock a colleague out of sign-in for up to 15 minutes by submitting that username repeatedly (limits are per identifier).
- Sessions last 5 days with no idle timeout, and unverified two-step sessions are not cleaned up sooner (deferred minors).
- Invite, resend and reset emails triggered by an admin have no rate limit of their own (a stolen admin session could send many).
- No Cloudflare rate-limit or WAF rule is configured; the application defends itself (limits, Argon2 cap, body limit), but a rule in front of `/api/auth/*` would add a layer.
- One machine hosts everything; the Postgres server is shared with other projects (they cannot read the `kmk` data without its role passwords, but share the server's availability and its superuser).
- Any process on the host can reach the loopback ports; the API still authenticates every request.
- Losing `MFA_ENCRYPTION_KEY` makes stored TOTP secrets unusable (recovery: `reset-mfa` per user). There is no key rotation yet.
- A compromised super admin session could do anything an admin can, and more; two-step verification is optional for now. A compromised admin session can disable or delete plain users (not admins).
- Event titles and notes are readable by every employee, and a person an event is for can delete a series someone else created (the audit log shows who).
- Task titles and descriptions are readable by every employee, and a person a task is for can delete it or change who it is for (the audit log shows who).
- The password policy is 8 characters with a mix (from the plan); a breached-password check and a longer minimum are deferred.

## Not covered yet

An audit log viewer; an off-site backup copy; dependency scanning that runs automatically in a build (`scripts/audit-deps.sh` is run by hand before deploys); the minor review findings listed in [security-review.md](security-review.md); privacy-law review (PIPEDA, Quebec Law 25, LGPD) before real customer data is stored. See the [roadmap](roadmap.md).
