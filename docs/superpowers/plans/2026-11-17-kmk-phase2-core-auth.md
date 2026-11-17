# kmk Phase 2 (Core auth) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `app.kmk-entretien.ca` requires a login: users, sessions and an append-only audit log; username-or-email login/logout with Argon2id, server-side sessions, rate limiting and CSRF protection; a CLI for the single super admin; a minimal login page and signed-in page.

**Architecture:** FastAPI gains an `app/auth/` package (routes, service, rate limiting, audit) over SQLAlchemy 2 models; Alembic revision `0002` creates the tables and grants. The API connects as the restricted `kmk_app` role (INSERT-only on `audit_log`); migrations run as `kmk`. Caddy passes the real client IP in a dedicated header that the API trusts only from loopback. The React app switches between a login form and a signed-in page based on `GET /api/auth/me`.

**Tech Stack:** as phase 1, plus `argon2-cffi`.

**Spec:** `docs/superpowers/specs/2026-11-17-phase2-core-auth-design.md` (also `scope.md` §4-§8)

## Global Constraints

- Hostname `app.kmk-entretien.ca`; API `127.0.0.1:8001`; Caddy `127.0.0.1:8081`; nothing beyond loopback.
- Roles: `kmk` (owner; migrations via `MIGRATION_DATABASE_URL`), `kmk_app` (runtime via `DATABASE_URL`; SELECT/INSERT/UPDATE/DELETE on `users`, `sessions`, `login_attempts`; **INSERT only on `audit_log`**; CONNECT on the database, USAGE on schema `public`). Tables use `GENERATED ... AS IDENTITY` ids so no sequence grants are needed.
- An INSERT-only role has no SELECT, so audit rows are written with a Core `insert()` that never uses `RETURNING` (no `.returning()`, no ORM flush of `AuditLog`).
- Tests never touch the real `kmk` database: `backend/tests/conftest.py` forces `DATABASE_URL=TEST_APP_DATABASE_URL` (`kmk_app`@`kmk_test`) and `MIGRATION_DATABASE_URL=TEST_DATABASE_URL` (`kmk_test` owner) before the app is imported.
- Cookie `kmk_session`: HttpOnly, Secure (setting `COOKIE_SECURE`, default true), SameSite=Strict, Path=/api, Max-Age 5 days. Session lifetime is absolute 5 days (`expires_at`).
- Settings (`app.config.Settings`, env names upper-case): `database_url`, `migration_database_url`, `session_secret`, `cookie_secure: bool = True`, `allowed_origins: list[str] = ["https://app.kmk-entretien.ca"]`, `session_days: int = 5`, `rl_ip_max: int = 10`, `rl_identifier_max: int = 5`, `rl_window_minutes: int = 15`, `trusted_proxy_ips: list[str] = ["127.0.0.1", "::1"]`.
- Error bodies: invalid login `401 {"error": "invalid_credentials"}`; limited `429 {"error": "too_many_attempts"}`; unauthenticated `401 {"error": "unauthenticated"}`; CSRF/Origin failure `403 {"error": "forbidden"}`.
- Password rule: min 8 chars with letters, digits and special characters. Request bodies: `identifier` max 256 chars, `password` max 1024 (longer → `422`, nothing hashed).
- No git history rewriting; commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Secrets only in git-ignored `.env` files; never echo passwords.
- **Deviation from spec (ruled at plan time):** the spec forwards the client IP in `X-Forwarded-For`; it can be spoofed unless Caddy replaces it. Instead Caddy sets `X-Real-Client-Ip` with `header_up X-Real-Client-Ip {client_ip}` (overwrites any client-supplied value; Caddy resolves `{client_ip}` from `Cf-Connecting-Ip` only for a trusted peer), and the API trusts that header only when the TCP peer is in `trusted_proxy_ips`.
- Phase 1 tests (`test_health.py`) must stay green.

## Review Focus

- Wrong password, unknown user, disabled and deleted users return the same status and body and the unknown-user path still runs a (dummy) Argon2 verify (Task 3 tests).
- `kmk_app` cannot UPDATE, DELETE or SELECT `audit_log`, but audit inserts work and the login flow never needs RETURNING on it (Task 1 + Task 3 tests).
- A spoofed `X-Real-Client-Ip` or `X-Forwarded-For` from a non-loopback peer, or from the browser through Caddy, never changes the recorded IP (Task 2 unit test, Task 6 live check).
- Expired, revoked, and disabled-user sessions are rejected; logout invalidates the cookie server-side (Task 3 tests).
- Mutating requests without an allowed `Origin`, or authenticated ones without a valid `X-CSRF-Token`, are rejected; huge passwords do not hang the server (Task 3 tests).

---

### Task 1: Roles, settings, schema migration

**Files:**
- Create: `backend/app/models.py`, `backend/alembic/versions/0002_core_auth.py`
- Modify: `backend/app/config.py`, `backend/alembic/env.py`, `backend/app/main.py` (`create_app` signature), `backend/pyproject.toml` (add `argon2-cffi>=23`), `backend/tests/conftest.py`
- Test: `backend/tests/test_schema_permissions.py`
- Untracked: `backend/.env`, `deploy/.env` stay untouched until Task 6 except where stated

**Interfaces:**
- Consumes: phase 1 `Settings`, `create_app`, `make_engine`.
- Produces:
  - SQLAlchemy 2 declarative models in `app.models`: `Base`, `User`, `UserSession` (table `sessions`), `AuditLog`, `LoginAttempt` with columns per spec §Decisions (users: `id, username, email, password_hash, role, locale, status, mfa_secret (nullable), mfa_enabled, created_at, updated_at, deleted_at`; sessions: `token_hash` PK, `user_id`, `created_at`, `expires_at`, `ip`, `user_agent`, `revoked_at`; audit_log: `id, timestamp, actor_user_id, action, target_user_id, ip, details (JSONB)`; login_attempts: `id, at, ip, identifier, success`).
  - `create_app(database_url: str | None = None, settings: Settings | None = None) -> FastAPI` (settings default `get_settings()`; `database_url` overrides `settings.database_url`).
  - Fixtures in `conftest.py`: `owner_engine` (session scope, `kmk_test` owner, runs `alembic upgrade head` once), `app_engine` (`kmk_app`), `clean_db` (autouse; truncates all four tables with `RESTART IDENTITY CASCADE` through `owner_engine`).

- [ ] **Step 1: Create the `kmk_app` role (outside the repo)**

Generate a password with `openssl rand -hex 24`; run `docker exec -i postgres psql -U postgres -d postgres` with `CREATE ROLE kmk_app LOGIN PASSWORD '<pw>';` and `GRANT CONNECT ON DATABASE kmk, kmk_test TO kmk_app;`. Write `DATABASE_URL=postgresql+psycopg://kmk_app:<pw>@127.0.0.1:5432/kmk`, `MIGRATION_DATABASE_URL` (the existing `kmk` owner URL), and a generated `SESSION_SECRET` into `backend/.env`; add `TEST_APP_DATABASE_URL` (`kmk_app`@`kmk_test`) and `SESSION_SECRET` for tests. Print nothing secret.
Expected: `\du` lists `kmk_app`.

- [ ] **Step 2: Write `test_schema_permissions.py` and conftest changes (tests first)**

Using `owner_engine` and `app_engine`:
- `test_app_role_can_insert_audit_but_not_update_delete_or_select`: as `kmk_app`, `INSERT INTO audit_log (action) VALUES ('x')` succeeds; `UPDATE audit_log ...`, `DELETE FROM audit_log`, and `SELECT * FROM audit_log` each raise `sqlalchemy.exc.ProgrammingError` (insufficient privilege).
- `test_app_role_has_full_dml_on_other_tables`: insert, update and delete a `users` row (valid username/email/hash) as `kmk_app`.
- `test_only_one_superadmin`: inserting two users with role `superadmin` (as owner) raises `IntegrityError`.
- `test_check_constraints`: invalid `role`, `locale` or `status` values raise `IntegrityError`.
- `test_username_email_unique_lowercase`: duplicate username raises `IntegrityError`; a mixed-case username or email insert is rejected by a CHECK (`username = lower(username)`, same for email).

- [ ] **Step 3: Run to watch it fail**

Run: `cd backend && .venv/bin/pip install -q -e '.[dev]' && .venv/bin/pytest tests/test_schema_permissions.py -q`
Expected: FAIL/ERROR (tables do not exist).

- [ ] **Step 4: Implement** `config.py` (settings above), `alembic/env.py` (use `migration_database_url`), `app/models.py`, and `0002_core_auth.py` with explicit DDL: the four tables with the CHECK constraints, unique constraints, the partial unique index `CREATE UNIQUE INDEX one_superadmin ON users (role) WHERE role = 'superadmin'`, index on `sessions(user_id)` and `login_attempts(at)`, a guard that raises if role `kmk_app` does not exist, then `GRANT USAGE ON SCHEMA public TO kmk_app`, the table grants from Global Constraints (audit_log: `GRANT INSERT` only). Update `create_app` and `conftest.py` per Interfaces.

- [ ] **Step 5: Run the whole backend suite**

Run: `cd backend && .venv/bin/pytest -q`
Expected: all pass (phase 1 tests included).

- [ ] **Step 6: Commit** `feat(db): users, sessions, audit_log, login_attempts and kmk_app grants`.

---

### Task 2: Security primitives

**Files:**
- Create: `backend/app/security.py`
- Test: `backend/tests/test_security.py`

**Interfaces:**
- Produces (all in `app.security`):
  - `hash_password(password: str) -> str` (Argon2id via `argon2.PasswordHasher`); `verify_password(password_hash: str, password: str) -> bool` (never raises on mismatch); `needs_rehash(password_hash: str) -> bool`; `DUMMY_HASH: str` (a real hash computed at import).
  - `validate_password_rules(password: str) -> list[str]` returning violated codes from `"too_short"`, `"no_letter"`, `"no_digit"`, `"no_special"` (empty list = valid).
  - `new_session_token() -> str` (32 random bytes, URL-safe); `hash_token(token: str) -> str` (hex SHA-256).
  - `csrf_token(session_token_hash: str, secret: str) -> str` (hex HMAC-SHA256); `verify_csrf(session_token_hash: str, secret: str, presented: str) -> bool` (constant time).
  - `client_ip(peer: str, forwarded: str | None, trusted: list[str]) -> str`: returns `forwarded` (stripped, valid per `ipaddress`) only when `peer` is in `trusted`; otherwise `peer`; an invalid or empty `forwarded` also yields `peer`.

- [ ] **Step 1: Write `test_security.py` (tests first)**
- hash starts with `$argon2id$`; verify true for right password, false for wrong, false (no exception) for a garbage hash; two hashes of one password differ.
- `validate_password_rules`: `"Abcdef1!"` → `[]`; `"short1!"` → `["too_short"]`; `"abcdefgh"` → `["no_digit", "no_special"]`; `"12345678!"` → `["no_letter"]`.
- Tokens: two tokens differ; `hash_token` is 64 hex chars and deterministic.
- CSRF: verify true for the matching token, false for another session hash, another secret, and an empty string.
- `client_ip`: trusted peer `127.0.0.1` + `"203.0.113.9"` → `"203.0.113.9"`; untrusted peer `198.51.100.7` + `"203.0.113.9"` → `"198.51.100.7"`; trusted peer + `"not-an-ip"` → peer; trusted peer + `None` → peer.

- [ ] **Step 2: Run to watch it fail** — `cd backend && .venv/bin/pytest tests/test_security.py -q` → FAIL (module missing).
- [ ] **Step 3: Implement** `app/security.py` to the Interfaces above (stdlib `hmac`, `hashlib`, `secrets`, `ipaddress`).
- [ ] **Step 4: Run to watch it pass** — same command → all pass.
- [ ] **Step 5: Commit** `feat(auth): password, token, CSRF and client-IP primitives`.

---

### Task 3: Auth endpoints, rate limiting, audit

**Files:**
- Create: `backend/app/auth/__init__.py`, `backend/app/auth/audit.py`, `backend/app/auth/ratelimit.py`, `backend/app/auth/service.py`, `backend/app/auth/routes.py`
- Modify: `backend/app/main.py` (include the router, Origin middleware/dependency, session factory on `app.state`)
- Test: `backend/tests/test_auth.py`

**Interfaces:**
- Consumes: Task 1 models/settings/fixtures; Task 2 `security` functions.
- Produces:
  - `audit.log(db: Session, action: str, *, actor_user_id: int | None = None, target_user_id: int | None = None, ip: str | None = None, details: dict | None = None) -> None` (Core insert, no RETURNING).
  - `ratelimit.is_limited(db: Session, ip: str, identifier: str, settings: Settings) -> bool` (true when failed attempts in the window reach `rl_ip_max` for the IP or `rl_identifier_max` for the identifier); `ratelimit.record_attempt(db: Session, ip: str, identifier: str, success: bool) -> None`.
  - `GET /api/auth/me` → `200 {"user": {"id","username","email","role","locale"}, "csrf_token": str}` or `401`.
  - `POST /api/auth/login` body `{"identifier": str, "password": str}` → `200` same shape as `me` plus the `Set-Cookie`; `401`/`429`/`422` per Global Constraints.
  - `POST /api/auth/logout` (requires cookie, `X-CSRF-Token`, allowed Origin) → `204`, revokes the session, clears the cookie.
  - Origin rule: every `POST/PUT/PATCH/DELETE` under `/api` needs an `Origin` header in `settings.allowed_origins`, else `403 {"error": "forbidden"}`.
  - Audit actions written: `login_success`, `login_failed`, `login_rate_limited`, `logout` (details never contain passwords or hashes; `login_failed` details hold the lowercased, 256-char-capped identifier).

- [ ] **Step 1: Write `test_auth.py` (tests first)** with a helper that creates users (via `hash_password`, through `owner_engine`) and a `TestClient(create_app(...), client=("127.0.0.1", 50000))` using test `Settings` (`cookie_secure=False`, `allowed_origins=["http://testserver"]`, low rate limits). Tests:
- `test_login_by_username_and_by_email_case_insensitive`: `"Alice"` and `"ALICE@Example.com"` both succeed with `200`, response user has no `password_hash` key, cookie `kmk_session` is set.
- `test_cookie_attributes_when_secure`: with `cookie_secure=True` the `Set-Cookie` contains `HttpOnly`, `Secure`, `SameSite=strict`, `Path=/api`, `Max-Age=432000`.
- `test_failures_are_indistinguishable`: wrong password, unknown user, `disabled` and `deleted` users all return the identical status `401` and body `{"error": "invalid_credentials"}`.
- `test_unknown_user_still_runs_a_verify`: monkeypatch `app.auth.service.verify_password` with a spy; an unknown-user login calls it once.
- `test_rate_limit_by_identifier`: after `rl_identifier_max` failures for one identifier (existing or not), the next attempt (even with the right password) is `429 {"error": "too_many_attempts"}`; a different identifier from the same IP is still `401`.
- `test_rate_limit_by_ip`: `rl_ip_max` failures with different identifiers → next attempt `429`.
- `test_me_requires_session`: `/api/auth/me` without cookie → `401 {"error": "unauthenticated"}`; after login → `200` with matching user.
- `test_session_expired_revoked_or_user_disabled_rejected`: set `expires_at` in the past, then `revoked_at`, then user `status='disabled'` (via owner connection), each → `/me` `401`.
- `test_logout_revokes_session`: logout with the token → `204`; `/me` with the old cookie → `401`; the `sessions` row has `revoked_at` set.
- `test_mutating_requests_need_origin_and_csrf`: login with no `Origin` or a foreign `Origin` → `403`; logout with a good `Origin` but missing or wrong `X-CSRF-Token` → `403`.
- `test_oversized_input`: a 1 MB password → `422` quickly (< 1 s) and no `login_attempts`/hash work.
- `test_audit_rows`: after a success, a failure, a rate-limited attempt and a logout the audit table (read via the owner) holds `login_success`, `login_failed`, `login_rate_limited`, `logout` with the right `ip` (peer or trusted `X-Real-Client-Ip`) and no password text in any `details`.
- `test_spoofed_client_ip_header_ignored_from_untrusted_peer`: a client with peer `198.51.100.7` sending `X-Real-Client-Ip: 1.2.3.4` is recorded as `198.51.100.7`; from peer `127.0.0.1` the header value is used.

- [ ] **Step 2: Run to watch it fail** — `cd backend && .venv/bin/pytest tests/test_auth.py -q` → FAIL (routes missing).
- [ ] **Step 3: Implement** the modules to the Interfaces. Login order: validate body → resolve IP → `is_limited` (limited → audit + `429`) → case-insensitive lookup by username-or-email → always one Argon2 verify (against `DUMMY_HASH` when no user) → reject non-`active` users identically → on success create session (`new_session_token`, store `hash_token`), `rehash` if `needs_rehash`, record attempt, audit, set cookie, return user + `csrf_token(token_hash, secret)`. Commit audit/attempt rows on failure paths too.
- [ ] **Step 4: Run the whole backend suite** — `cd backend && .venv/bin/pytest -q` → all pass.
- [ ] **Step 5: Commit** `feat(auth): login, logout, me with sessions, rate limiting and audit log`.

---

### Task 4: Super admin CLI

**Files:**
- Create: `backend/app/cli.py`
- Test: `backend/tests/test_cli.py`

**Interfaces:**
- Consumes: `models`, `security.hash_password`, `security.validate_password_rules`, `audit.log`.
- Produces: `python -m app.cli create-superadmin --username U --email E [--locale fr-CA|en|pt-BR]`; password read with `getpass` when stdin is a TTY, else one line from stdin (for scripts/tests); `main(argv: list[str] | None = None) -> int` (exit code `0` ok, `1` refused).

- [ ] **Step 1: Write `test_cli.py` (tests first)**, calling `main([...])` with a patched password source:
- creates a `superadmin` user (username and email lowercased, Argon2id hash, locale default `fr-CA`) and writes a `user_created` audit row with `actor_user_id` null;
- a weak password is refused (exit `1`), no user row;
- a second call is refused (exit `1`) because a super admin exists;
- the password never appears in captured stdout/stderr.

- [ ] **Step 2: Run to watch it fail** — `cd backend && .venv/bin/pytest tests/test_cli.py -q` → FAIL.
- [ ] **Step 3: Implement** `app/cli.py` (argparse, uses `get_settings().database_url`, so tests set the env via conftest).
- [ ] **Step 4: Run the whole backend suite** → all pass.
- [ ] **Step 5: Commit** `feat(cli): create-superadmin command`.

---

### Task 5: Frontend login and signed-in pages

**Files:**
- Create: `frontend/src/api.ts`, `frontend/src/LoginForm.tsx`, `frontend/src/SignedIn.tsx`
- Modify: `frontend/src/App.tsx`, `frontend/src/App.test.tsx`, `frontend/src/locales/{fr-CA,en,pt-BR}.json`, `frontend/src/index.css`
- Test: `frontend/src/App.test.tsx`

**Interfaces:**
- Consumes: `GET/POST /api/auth/*` (Task 3), i18n from phase 1.
- Produces:
  - `api.ts`: `type User = {id: number; username: string; email: string; role: "user"|"admin"|"superadmin"; locale: "fr-CA"|"en"|"pt-BR"}`; `me(): Promise<{user: User; csrfToken: string} | null>`; `login(identifier: string, password: string): Promise<{ok: true; user: User; csrfToken: string} | {ok: false; reason: "invalid" | "rate_limited" | "network"}>`; `logout(csrfToken: string): Promise<void>`. All `fetch` calls use `credentials: "same-origin"`; `login` sends JSON; `logout` sends `X-CSRF-Token`. The CSRF token lives only in React state.
  - Locale keys, identical in all three files: `signInTitle`, `identifier`, `password`, `signIn`, `signOut`, `welcome` (uses `{{name}}`), `roleLabel`, `role_user`, `role_admin`, `role_superadmin`, `invalidCredentials`, `tooManyAttempts`, `networkError`, `checking`. The phase 1 keys `title`, `apiOk`, `apiDown` are removed (the health line is gone; the placeholder text is replaced by the login page).
  - `App`: shows `checking` until `me()` resolves; no session → `LoginForm` (h1 `signInTitle`; inputs with `autoComplete` `username` / `current-password`; generic error messages); session → `SignedIn` (h1 `welcome`, role, sign-out button). After login or on load with a session, `i18n.changeLanguage(user.locale)`; after logout back to `fr-CA`. `document.title` stays `KMK Entretien Ménager`.

- [ ] **Step 1: Rewrite `App.test.tsx` (tests first)**, mocking `fetch`:
- shows the login form (heading `Connexion`, labelled fields) when `/api/auth/me` is `401`;
- successful login shows `Bonjour, <username>` and switches the UI to the user's locale (`en` user sees the English sign-out label);
- `401` shows `invalidCredentials`, `429` shows `tooManyAttempts`, a rejected fetch shows `networkError`;
- an existing session on load goes straight to the signed-in page;
- logout sends `POST /api/auth/logout` with the `X-CSRF-Token` returned by login and returns to the form;
- the password input is `type="password"`; all three locale files define the same keys.

- [ ] **Step 2: Run to watch it fail** — `cd frontend && npx vitest run` → FAIL.
- [ ] **Step 3: Implement** the files above. Keep the KMK look (the white card, tokens from `index.css`); the form must be usable at phone width and in dark mode; no router library.
- [ ] **Step 4: Run tests and build** — `cd frontend && npx vitest run && npm run build` → all pass; `dist/` built.
- [ ] **Step 5: Commit** `feat(frontend): login form and signed-in page`.

---

### Task 6: Deploy and verify live

**Files:**
- Modify: `deploy/caddy/Caddyfile`, `deploy/.env` (untracked)
- Rebuild: `kmk-api` image

**Interfaces:**
- Consumes: everything above; `kmk_app` role from Task 1.
- Produces: the live login system; a handoff for the user to create the super admin.

- [ ] **Step 1: Update `deploy/.env`** to the Task 1 values (`DATABASE_URL` as `kmk_app`, `MIGRATION_DATABASE_URL` as `kmk`, `SESSION_SECRET`, `COOKIE_SECURE=true`); update `deploy/.env.example` with the new names and placeholders; commit the example only.
- [ ] **Step 2: Caddy:** inside `handle /api/*`, change to `reverse_proxy 127.0.0.1:8001 { header_up X-Real-Client-Ip {client_ip} }`. Validate with `caddy validate` (as in phase 1).
- [ ] **Step 3: Rebuild frontend and redeploy:** `cd frontend && npm run build`, then `cd deploy && docker compose up -d --build`.
Expected: `kmk-api` runs `alembic upgrade head` (revision `0002`) and starts; `docker logs kmk-api` shows no errors.

- [ ] **Step 4: Verify through Caddy**

```bash
H='Host: app.kmk-entretien.ca'; B=http://127.0.0.1:8081; O='Origin: https://app.kmk-entretien.ca'
curl -s -H "$H" $B/api/health                                                  # {"status":"ok"}
curl -s -o /dev/null -w '%{http_code}\n' -H "$H" $B/api/auth/me                 # 401
curl -s -w ' %{http_code}\n' -H "$H" -H "$O" -H 'Content-Type: application/json' -d '{"identifier":"nobody","password":"x"}' $B/api/auth/login   # {"error":"invalid_credentials"} 401
curl -s -o /dev/null -w '%{http_code}\n' -H "$H" -H 'Content-Type: application/json' -d '{"identifier":"nobody","password":"x"}' $B/api/auth/login   # 403 (no Origin)
for i in 1 2 3 4 5 6; do curl -s -o /dev/null -w '%{http_code} ' -H "$H" -H "$O" -H 'Cf-Connecting-Ip: 203.0.113.50' -H 'X-Real-Client-Ip: 9.9.9.9' -H 'Content-Type: application/json' -d '{"identifier":"smoke-nobody","password":"x"}' $B/api/auth/login; done; echo   # 401 ×5 then 429
docker exec postgres psql -U postgres -d kmk -Atc "select ip, action from audit_log order by id desc limit 3"   # ip is 203.0.113.50, never 9.9.9.9
docker exec postgres psql -U postgres -d kmk -Atc "select count(*) from users"   # 0 (no accounts yet)
docker exec kmk-api id -u                                                      # not 0
docker ps --format '{{.Names}}' | grep -E 'famillai|^postgres$'               # all still running
```

- [ ] **Step 5: Hand off to the user:** report the check results and give the user this command to run themselves (password prompt is hidden and must not pass through the assistant): `cd /home/evandro/projects/kmk/deploy && docker compose exec api python -m app.cli create-superadmin --username <name> --email <email>`; then open `https://app.kmk-entretien.ca`, sign in, check the signed-in page and logout, look at it at phone width and in dark mode. Do not create any account on the user's behalf.
- [ ] **Step 6: Commit** `feat(deploy): forward real client IP, enable phase 2 settings`.
