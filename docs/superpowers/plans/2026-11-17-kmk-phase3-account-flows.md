# kmk Phase 3 (Account flows) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Invite by email, password reset (user- or admin-triggered), password change, and emails in the recipient's language through Resend (or a local log backend), with the frontend pages for them.

**Architecture:** A `tokens` table (hashed, single-use, expiring) and an `app/emails/` layer (templates + `log`/`resend` backends, sent after the response). New routers `app/auth/account.py` (forgot/set/change password) and `app/auth/admin.py` (admin-gated invite/reset endpoints) on top of the phase 2 auth package. The React app gains three small pages chosen by `location.pathname`, with the emailed token carried in the URL fragment.

**Tech Stack:** as phases 1-2; `httpx` becomes a runtime dependency (Resend calls).

**Spec:** `docs/superpowers/specs/2026-11-17-phase3-account-flows-design.md` (also `scope.md` §4-§9 and the phase 2 design)

## Global Constraints

- Everything in the phase 2 Global Constraints still holds (kmk_app runtime role, INSERT-only audit log written without RETURNING, Origin check on mutating `/api` requests, per-session CSRF token via `X-CSRF-Token`, real client IP via `X-Real-Client-Ip`, tests only on `kmk_test`, git identity already set, commit trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`).
- New settings in `app.config.Settings`: `email_backend: str = "log"` (`log` or `resend`), `resend_api_key: str | None = None`, `email_from: str = "KMK Entretien <no-reply@mail.kmk-entretien.ca>"`, `public_base_url: str = "https://app.kmk-entretien.ca"`, `invite_hours: int = 48`, `reset_minutes: int = 30`.
- Token links: `{public_base_url}/set-password#token={raw_token}` (fragment, never a query string or path). Tokens: 32 random bytes URL-safe, stored only as SHA-256 hex. Never write a token, link or password to the database, to audit rows, or to logs, except the full message printed by the dev `log` email backend.
- Error bodies: bad/expired/used token `400 {"error": "invalid_token"}`; weak password `422 {"error": "weak_password", "rules": [<codes from app.security.validate_password_rules>]}`; same password on change `422 {"error": "same_password"}`; wrong current password `403 {"error": "invalid_current_password"}`; limited `429 {"error": "too_many_attempts"}`; admin-only `403 {"error": "forbidden"}`; anonymous `401 {"error": "unauthenticated"}`; duplicate user `409 {"error": "already_exists"}`; wrong target state `409 {"error": "not_invited"}` / `{"error": "not_active"}`; unknown user id `404 {"error": "not_found"}`.
- Roles in this phase: only role `user` can be invited. Admin endpoints require role `admin` or `superadmin`. A non-superadmin may not trigger a reset for the superadmin.
- All `/api/auth/*` and `/api/admin/*` responses carry `Cache-Control: no-store`.
- **Rulings at plan time:** (1) the admin create-user response says `email_queued: true`, not `email_sent`, because mail is sent after the response (design doc said `email_sent`); (2) a weak password is rejected before the token is redeemed so a typo does not burn the link; (3) the CSRF/session check for authenticated endpoints is factored into one helper that raises `ApiError`.
- Phase 1 and 2 tests must stay green.

## Review Focus

- `forgot-password` returns the identical status and body for existing, unknown, disabled, deleted and invited accounts, and only queues email for active ones (Task 3 tests).
- A token works once: not twice, not after expiry, not after a newer one was issued, and two simultaneous redeems yield exactly one winner (Task 2 and Task 3 tests).
- A weak new password does not consume the token; a successful reset revokes all of the user's sessions; a password change revokes all other sessions but keeps the current one (Task 3 tests).
- Admin endpoints reject anonymous, plain users, missing Origin/CSRF, and admin-on-superadmin reset; invited users cannot log in until they have set a password (Task 3 and 4 tests).
- A failing or slow email provider neither changes the HTTP response nor leaks the API key, and the dev `log` backend is the only place a link is printed (Task 2 tests).

---

### Task 1: Schema, settings, shared test helpers

**Files:**
- Create: `backend/alembic/versions/0003_account_flows.py`, `backend/tests/helpers.py`
- Modify: `backend/app/models.py`, `backend/app/config.py`, `backend/app/auth/ratelimit.py`, `backend/app/auth/service.py`, `backend/app/auth/routes.py`, `backend/pyproject.toml` (move `httpx>=0.27` to runtime `dependencies`), `backend/tests/conftest.py`, `backend/tests/test_auth.py`
- Test: `backend/tests/test_schema_permissions.py` (extend), `backend/tests/test_ratelimit_kinds.py`

**Interfaces:**
- Consumes: phase 2 models, `ratelimit`, fixtures.
- Produces:
  - Migration `0003`: table `tokens(token_hash varchar(64) PK, user_id bigint FK users, purpose text CHECK in ('invite','reset'), created_at timestamptz default now(), expires_at timestamptz, used_at timestamptz null)` + index on `user_id`; `users.password_hash` nullable; `users_status_valid` check now allows `'invited'`; `login_attempts.kind text not null default 'login'` with CHECK in (`login`,`reset_request`,`token`); `GRANT SELECT, INSERT, UPDATE, DELETE ON tokens TO kmk_app`.
  - `app.models.Token`; `User.password_hash: Mapped[str | None]`; `LoginAttempt.kind`.
  - `ratelimit.is_limited(db, ip, identifier, settings, kind="login") -> bool` and `ratelimit.record_attempt(db, ip, identifier, success, kind="login") -> None`; counting is per `kind`. Existing phase 2 callers keep working unchanged.
  - `service.authenticate`: a user whose `password_hash` is `None` is verified against `DUMMY_HASH` (so `invited` users cannot log in and look like any failure).
  - `tests/helpers.py`: `ORIGIN`, `PW`, `make_settings(**kw) -> Settings`, `login(client, identifier, password, headers)`, `sql(engine, query, **params)`. `conftest.py` gains the fixtures `make_client`, `client`, `add_user` moved out of `test_auth.py` (same signatures; `add_user` also accepts `password: str | None` and `status="invited"`; `clean_db` also truncates `tokens`).

- [ ] **Step 1: Write the tests first**
  - Extend `test_schema_permissions.py`: `kmk_app` has full DML on `tokens`; a user with status `invited` and `password_hash` NULL can be inserted; `purpose='other'` is rejected; `login_attempts.kind='bogus'` is rejected.
  - `test_ratelimit_kinds.py`: with `rl_identifier_max=2`, two failed `login` attempts for identifier `a` make `is_limited(..., kind="login")` true and `is_limited(..., kind="reset_request")` false; the same per IP; `record_attempt` defaults to kind `login`.
  - In `test_auth.py` add `test_invited_user_cannot_log_in`: an `invited` user with no password returns the same `401 {"error": "invalid_credentials"}` as an unknown user, and a verify is still run.

- [ ] **Step 2: Run to watch them fail** — `cd backend && .venv/bin/pytest -q` → new tests FAIL/ERROR (columns and table missing).

- [ ] **Step 3: Implement** the migration, model, settings and `ratelimit`/`service` changes to the Interfaces; do the test-helper refactor (move fixtures and helpers, update imports in `test_auth.py`, no behavior change).

- [ ] **Step 4: Run the whole suite** — `cd backend && .venv/bin/pytest -q` → all pass (phase 1 and 2 tests included).

- [ ] **Step 5: Commit** `feat(db): tokens table, invited status, rate-limit kinds`.

---

### Task 2: Tokens and the email layer

**Files:**
- Create: `backend/app/auth/tokens.py`, `backend/app/emails/__init__.py`, `backend/app/emails/templates.py`, `backend/app/emails/backends.py`, `backend/app/emails/sender.py`
- Test: `backend/tests/test_tokens.py`, `backend/tests/test_emails.py`

**Interfaces:**
- Consumes: Task 1 models/settings; `app.security.new_session_token`, `hash_token`.
- Produces:
  - `tokens.issue_token(db: Session, user_id: int, purpose: str, ttl: timedelta) -> str`: creates a row (hash only), first marking the user's other unused tokens of the same purpose as used; returns the raw token.
  - `tokens.redeem_token(db: Session, raw: str) -> tuple[int, str] | None`: one atomic `UPDATE tokens SET used_at = now() WHERE token_hash = :h AND used_at IS NULL AND expires_at > now() RETURNING user_id, purpose`; returns `(user_id, purpose)` or `None`.
  - `templates.EmailMessage` (dataclass: `to: str`, `subject: str`, `text: str`, `html: str`); `templates.render(kind: str, locale: str, link: str, to: str) -> EmailMessage` for `kind` in `invite`, `reset` and `locale` in `fr-CA`, `en`, `pt-BR` (unknown locale falls back to `fr-CA`); every message contains the link, the expiry in words (48 hours / 30 minutes in that language) and an "ignore this if you did not expect it" line.
  - `templates.build_link(settings: Settings, raw_token: str) -> str` → `{public_base_url}/set-password#token={raw_token}`.
  - `backends.send_email(message: EmailMessage, settings: Settings, transport: httpx.BaseTransport | None = None) -> bool`: `log` backend logs the whole message once (logger `kmk.email`, prefixed `DEV EMAIL`) and returns `True`; `resend` backend POSTs JSON `{from, to: [..], subject, html, text}` to `https://api.resend.com/emails` with header `Authorization: Bearer <key>`, 10 s timeout, returns `True` on 2xx, otherwise (error, timeout, non-2xx, missing key) logs a message without the key and returns `False`.
  - `sender.deliver(engine: Engine, settings: Settings, message: EmailMessage, target_user_id: int | None) -> None`: calls `backends.send_email` (looked up on the `app.emails.sender` module so tests can monkeypatch `app.emails.sender.send_email`); on `False` writes audit `email_failed` (details `{"to_domain": <domain of recipient>}`, no address, no key) in its own `Session`; never raises.

- [ ] **Step 1: Write the tests first**
  - `test_tokens.py`: issue returns a token whose hash (not the raw value) is in the table; redeem succeeds once and returns `(user_id, purpose)`, a second redeem returns `None`; an expired token (`ttl` negative) returns `None`; issuing a second token of the same purpose makes the first redeem `None` but not a token of the other purpose; **concurrent redeem**: two threads, each with its own `Session`, redeem the same token at once and exactly one gets a result.
  - `test_emails.py`: all six (kind × locale) renders contain the link (with `#token=`), no `?token`, the expiry words and a non-empty subject; an unknown locale falls back to French; `log` backend returns `True` and the log record contains the link; `resend` backend with `httpx.MockTransport`: request is `POST https://api.resend.com/emails`, `Authorization` is `Bearer test-key`, JSON has `from`, `to == [address]`, `subject`, `html`, `text`; a 500 response and a raised `httpx.ConnectTimeout` both return `False` and `caplog` never contains `test-key`; missing key returns `False`; `deliver` with a failing backend writes one `email_failed` audit row (read via the owner engine) whose details contain neither the address nor the key, and does not raise.

- [ ] **Step 2: Run to watch them fail** — `cd backend && .venv/bin/pytest tests/test_tokens.py tests/test_emails.py -q` → FAIL (modules missing).
- [ ] **Step 3: Implement** the modules to the Interfaces. Wording of the six templates is yours (KMK Entretien Ménager, polite, short); keep the HTML simple with the KMK colors `#007A78` and `#16242C`.
- [ ] **Step 4: Run the whole suite** → all pass.
- [ ] **Step 5: Commit** `feat(auth): single-use tokens and the email layer`.

---

### Task 3: Forgot, set and change password

**Files:**
- Create: `backend/app/auth/errors.py`, `backend/app/auth/account.py`
- Modify: `backend/app/main.py` (include router, `ApiError` handler, `Cache-Control: no-store` for `/api/auth` and `/api/admin`), `backend/app/auth/routes.py` (use the shared auth helper for logout)
- Test: `backend/tests/test_account.py`

**Interfaces:**
- Consumes: Tasks 1-2; phase 2 `routes.get_db`, `get_settings_dep`, `request_ip`, `service.*`, `audit.log`.
- Produces:
  - `errors.ApiError(status: int, code: str)` (exception) and an app exception handler returning `JSONResponse({"error": code}, status)`.
  - `routes.require_auth(request, db, settings, *, csrf: bool) -> tuple[User, UserSession]` raising `ApiError(401, "unauthenticated")` or `ApiError(403, "forbidden")` (bad/missing `X-CSRF-Token` when `csrf=True`).
  - `POST /api/auth/forgot-password` `{identifier}` → `202 {"status": "ok"}` always; rate limit kind `reset_request` (record every request, limit by IP and identifier → `429`); for an `active` user: `tokens.issue_token(..., "reset", timedelta(minutes=settings.reset_minutes))`, audit `password_reset_requested` (`details {"via": "user"}`), email queued with FastAPI `BackgroundTasks` calling `sender.deliver`.
  - `POST /api/auth/set-password` `{token: str (max 512), password: str (max 1024)}` → `200 {"status": "ok"}`; order: IP rate limit kind `token` (limit → `429`), password rules (`422`, token untouched), `tokens.redeem_token` (`None` → record failed `token` attempt, `400 invalid_token`), then: purpose `invite` requires user status `invited` and sets `active`; purpose `reset` requires `active`; any mismatch → rollback and `400 invalid_token`. Sets `password_hash`, marks the user's remaining unused tokens used, for `reset` also `UPDATE sessions SET revoked_at = now() WHERE user_id = :id AND revoked_at IS NULL`; audit `invite_accepted` or `password_reset_completed`. Does not create a session.
  - `POST /api/auth/change-password` `{current_password, new_password}` (both max 1024), signed in with CSRF → `200 {"status": "ok"}`; wrong current → record failed `login` attempt for the username, `403 invalid_current_password`; limited → `429`; rules `422`; same password `422 same_password`; success revokes all other sessions of the user (keeps the current), audit `password_changed`.

- [ ] **Step 1: Write `test_account.py` first** (helpers from `tests/helpers.py`; monkeypatch `app.emails.sender.send_email` to collect messages):
  - `test_forgot_password_identical_for_every_state`: for an active, unknown, disabled, deleted and invited user the response is exactly `202 {"status": "ok"}`; only the active user produced exactly one collected email, addressed to them, containing `/set-password#token=`; its locale matches the user's.
  - `test_forgot_password_rate_limited_generically`: after `rl_identifier_max` requests for one identifier the next is `429 {"error": "too_many_attempts"}`, also for an unknown identifier; login attempts are not affected.
  - `test_invite_accept_then_login`: an `invited` user plus a token issued with `tokens.issue_token(..., "invite", ...)`: `set-password` returns `200`, user becomes `active`, login with the new password works, and no session existed before; the token is now unusable (`400`).
  - `test_reset_flow_revokes_all_sessions`: a logged-in user, a reset token, `set-password` → `200`; the old cookie returns `401` on `/me`; login with the new password works; old password fails.
  - `test_weak_password_does_not_consume_token`: `set-password` with `"short"` returns `422` and the rules; the same token then succeeds with a valid password.
  - `test_bad_tokens_are_generic`: unknown, expired, already used and superseded tokens each return `400 {"error": "invalid_token"}`; a reset token for a now-disabled user also returns `400`.
  - `test_set_password_token_rate_limit`: repeated bad tokens from one IP eventually return `429`.
  - `test_change_password`: wrong current → `403 invalid_current_password`; same password → `422 same_password`; weak → `422`; success → `200`, a second logged-in session of the same user gets `401`, the current one still works, the new password logs in; no CSRF token → `403`; anonymous → `401`.
  - `test_audit_for_account_flows`: expected actions appear (`password_reset_requested`, `invite_accepted`, `password_reset_completed`, `password_changed`) and no audit `details` or captured log contains a raw token or password.
  - `test_no_store_header`: `/api/auth/forgot-password` and `/api/auth/me` responses have `Cache-Control: no-store`.

- [ ] **Step 2: Run to watch them fail** — `cd backend && .venv/bin/pytest tests/test_account.py -q` → FAIL.
- [ ] **Step 3: Implement** to the Interfaces. Keep phase 2 behavior (logout, login, me) identical.
- [ ] **Step 4: Run the whole suite** → all pass.
- [ ] **Step 5: Commit** `feat(auth): forgot, set and change password`.

---

### Task 4: Admin invite and reset endpoints

**Files:**
- Create: `backend/app/auth/admin.py`
- Modify: `backend/app/main.py` (include the router)
- Test: `backend/tests/test_admin.py`

**Interfaces:**
- Consumes: Task 3 `require_auth`, `ApiError`; Task 2 tokens/emails; phase 2 `service.user_payload`.
- Produces (all require role `admin`/`superadmin`, CSRF and allowed Origin, router prefix `/api/admin`):
  - `POST /users` body `{username: str, email: str, locale: "fr-CA"|"en"|"pt-BR"}`: username lowercased, 3-32 chars of `[a-z0-9._-]`; email lowercased, must look like an address (simple regex, max 254); creates a `user`-role, `invited`, password-less account; issues an invite token (`invite_hours`), audit `user_invited` (actor = admin, target = new user), queues the invite email; `201 {"user": <user_payload>, "email_queued": true}`; duplicate username or email `409 already_exists`; invalid input `422`.
  - `POST /users/{user_id}/invite`: `404` unknown, `409 not_invited` unless status `invited`; issues a new invite token (older one dies), audit `invite_resent`, queues email; `202 {"status": "ok"}`.
  - `POST /users/{user_id}/reset`: `404` unknown; `403 forbidden` when the target is the superadmin and the actor is not; `409 not_active` unless status `active`; issues a reset token, audit `password_reset_requested` (`details {"via": "admin"}`), queues email; `202 {"status": "ok"}`.

- [ ] **Step 1: Write `test_admin.py` first** (collect emails by monkeypatching `app.emails.sender.send_email`):
  - `test_admin_gate`: for each endpoint, anonymous → `401`, a plain `user` → `403`, an admin without `X-CSRF-Token` → `403`, no `Origin` → `403`.
  - `test_create_user_invites`: an admin creates a user (`Maria`, `MARIA@Example.com`, `pt-BR`) → `201`, stored lowercase with role `user`, status `invited`, `password_hash` NULL; exactly one email, to `maria@example.com`, in Portuguese, with a `#token=` link; the audit row `user_invited` has the admin as actor; the full flow then works: redeem the emailed token via `POST /api/auth/set-password`, log in as `maria`.
  - `test_create_user_validation`: duplicate username → `409`, duplicate email (different case) → `409`, bad username/email/locale → `422`; no email sent for any of them.
  - `test_resend_invite`: second invite makes the first link return `400` on set-password and the new one work; `409 not_invited` for an active user; `404` for unknown id.
  - `test_admin_reset`: reset for an active user queues one email and audit `via: admin`; `409 not_active` for an invited/disabled user; an `admin` targeting the superadmin gets `403`, the superadmin targeting themselves or an admin succeeds.
  - `test_superadmin_can_use_admin_endpoints` (role `superadmin` passes the gate).

- [ ] **Step 2: Run to watch them fail** — `cd backend && .venv/bin/pytest tests/test_admin.py -q` → FAIL.
- [ ] **Step 3: Implement** `admin.py` to the Interfaces.
- [ ] **Step 4: Run the whole suite** → all pass.
- [ ] **Step 5: Commit** `feat(admin): invite and reset endpoints`.

---

### Task 5: Frontend pages

**Files:**
- Create: `frontend/src/route.ts`, `frontend/src/SetPassword.tsx`, `frontend/src/ForgotPassword.tsx`, `frontend/src/ChangePassword.tsx`
- Modify: `frontend/src/api.ts`, `frontend/src/App.tsx`, `frontend/src/LoginForm.tsx`, `frontend/src/SignedIn.tsx`, `frontend/src/locales/{fr-CA,en,pt-BR}.json`, `frontend/src/index.css`
- Test: `frontend/src/Account.test.tsx` (new); `frontend/src/App.test.tsx` keeps passing

**Interfaces:**
- Consumes: Tasks 3 endpoints, phase 2 `api.ts`.
- Produces:
  - `api.ts`: `forgotPassword(identifier: string): Promise<"ok" | "rate_limited" | "network">`; `setPassword(token: string, password: string): Promise<{ok: true} | {ok: false; reason: "invalid_token" | "weak" | "rate_limited" | "network"}>`; `changePassword(csrfToken: string, current: string, next: string): Promise<{ok: true} | {ok: false; reason: "wrong_password" | "weak" | "same" | "rate_limited" | "network"}>`. Same fetch conventions as phase 2 (JSON body, `credentials: "same-origin"`, `X-CSRF-Token` for `changePassword`).
  - `route.ts`: `useRoute(): { path: string; navigate: (to: string) => void }` reading `location.pathname`, updating on `popstate` and after `navigate` (uses `history.pushState`).
  - `App`: `/set-password` → `SetPassword`; `/forgot-password` → `ForgotPassword`; anything else → the phase 2 behavior. `SetPassword` reads the token from `location.hash` (`#token=...`), immediately replaces the URL with `/set-password` (`history.replaceState`), shows the `invalidLink` message at once when there is no token, requires matching confirmation before calling the API, and after success shows a message plus a link to sign in. `LoginForm` gets a "forgot password" link; `SignedIn` renders `ChangePassword`.
  - New locale keys, identical in all three files: `forgotPasswordLink`, `forgotTitle`, `forgotIntro`, `send`, `forgotDone`, `backToSignIn`, `setPasswordTitle`, `newPassword`, `confirmPassword`, `passwordsDontMatch`, `passwordRules`, `weakPassword`, `invalidLink`, `setPasswordDone`, `changePasswordTitle`, `currentPassword`, `changePassword`, `passwordChanged`, `wrongCurrentPassword`, `samePassword`.

- [ ] **Step 1: Write `Account.test.tsx` first** (mock `fetch` like `App.test.tsx`; set the URL with `window.history.pushState({}, "", "/set-password#token=abc")` before rendering; reset to `/` in `afterEach`):
  - forgot flow: from the login page, the forgot link opens the form; submitting shows `forgotDone` (also when the mocked API says `202` for an unknown name, i.e. the message never varies); a rejected fetch shows `networkError`; a `429` shows `tooManyAttempts`.
  - set-password: the page posts `{token: "abc", password}` to `/api/auth/set-password`; `location.hash` is empty afterwards; success shows `setPasswordDone`; `400` shows `invalidLink`; `422` shows `weakPassword`; mismatched confirmation shows `passwordsDontMatch` and makes no request; no token in the URL shows `invalidLink` and no form.
  - change-password on the signed-in page: sends `X-CSRF-Token` and `{current_password, new_password}`; success shows `passwordChanged`; `403` shows `wrongCurrentPassword`; `422 same_password` shows `samePassword`.
  - locale parity for all three files (extend the existing parity test if simpler).

- [ ] **Step 2: Run to watch them fail** — `cd frontend && npx vitest run` → new tests FAIL.
- [ ] **Step 3: Implement** the files above in the KMK look (phase 1/2 CSS tokens), usable at phone width and in dark mode, `autoComplete="new-password"` on new-password fields, no router library.
- [ ] **Step 4: Run tests and build** — `cd frontend && npx vitest run && npm run build` → all pass.
- [ ] **Step 5: Commit** `feat(frontend): forgot, set and change password pages`.

---

### Task 6: Deploy and verify live

**Files:**
- Modify: `deploy/.env` (untracked), `deploy/.env.example`

**Interfaces:**
- Consumes: everything above.
- Produces: the live account flows in `log` email mode, ready to switch to Resend.

- [ ] **Step 1: Settings:** append `EMAIL_BACKEND=log`, `PUBLIC_BASE_URL=https://app.kmk-entretien.ca`, `EMAIL_FROM=KMK Entretien <no-reply@mail.kmk-entretien.ca>` to `deploy/.env`; update `deploy/.env.example` with those and a commented `# RESEND_API_KEY=` plus a note that switching to Resend means `EMAIL_BACKEND=resend` and the key. Commit the example only.
- [ ] **Step 2: Rebuild and deploy:** `cd frontend && npm run build`, then `cd deploy && docker compose up -d --build` (Caddy config unchanged, no restart needed).
Expected: `kmk-api` runs `alembic upgrade head` to `0003`; no errors in `docker logs kmk-api`.

- [ ] **Step 3: Verify through Caddy** (do not touch the real `evandro` account):

```bash
H='Host: app.kmk-entretien.ca'; B=http://127.0.0.1:8081; O='Origin: https://app.kmk-entretien.ca'; J='Content-Type: application/json'
docker exec postgres psql -U postgres -d kmk -Atc "select version_num from alembic_version"            # 0003
curl -s -w ' %{http_code}\n' -H "$H" -H "$O" -H "$J" -d '{"identifier":"nobody-here"}' $B/api/auth/forgot-password   # {"status":"ok"} 202
curl -s -w ' %{http_code}\n' -H "$H" -H "$O" -H "$J" -d '{"token":"bogus","password":"Abcdef1!"}' $B/api/auth/set-password   # {"error":"invalid_token"} 400
curl -s -o /dev/null -w 'admin anon %{http_code}\n' -H "$H" -H "$O" -H "$J" -d '{}' $B/api/admin/users        # 401
curl -s -o /dev/null -w 'no origin %{http_code}\n' -H "$H" -H "$J" -d '{"identifier":"x"}' $B/api/auth/forgot-password   # 403
curl -sI -H "$H" $B/api/auth/me | grep -i '^cache-control'                                                  # no-store
for i in 1 2 3 4 5 6; do curl -s -o /dev/null -w '%{http_code} ' -H "$H" -H "$O" -H "$J" -d '{"identifier":"smoke-reset"}' $B/api/auth/forgot-password; done; echo   # 202 x5 then 429
docker exec postgres psql -U postgres -d kmk -Atc "select count(*) from tokens"                             # 0 (nothing issued for unknown users)
docker logs kmk-api 2>&1 | grep -c 'DEV EMAIL'                                                              # 0 (no email for unknown users)
docker exec kmk-api id -u                                                                                    # not 0
docker ps --format '{{.Names}}' | grep -E 'famillai|^postgres$'                                              # all still running
curl -s -o /dev/null -w 'public %{http_code}\n' https://app.kmk-entretien.ca/set-password                    # 200 (SPA deep link)
```

- [ ] **Step 4: Hand off to the user** (their own account, their own browser): (a) open `https://app.kmk-entretien.ca`, click "Forgot password", enter their username, then read the link with `docker logs kmk-api 2>&1 | grep -A8 'DEV EMAIL' | tail -12` and open it; set a new password; sign in with it; (b) on the signed-in page change the password again; (c) check phone width and dark mode. Remind them that the links only appear in the API log until Resend is configured (`EMAIL_BACKEND=resend`, `RESEND_API_KEY`, then `docker compose up -d`), and that a deliverability test to Gmail/Outlook/a Canadian provider belongs to that moment. Do not request or handle their password.
- [ ] **Step 5: Commit** `feat(deploy): phase 3 settings`.
