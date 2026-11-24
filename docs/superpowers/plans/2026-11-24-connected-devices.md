# Connected Devices and Users Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The super admin sees every active session grouped by person (device, last access, IP, approximate location) and can end one or all of a person's sessions.

**Architecture:** `sessions` gains a public uuid, last-seen time, last IP and Cloudflare-derived country/city, written at most once per 5 minutes per session. Guarded admin routes (`policy.check`, super admin only) list and revoke. A `/devices` page, nav entry for the super admin only.

**Tech Stack:** FastAPI, SQLAlchemy, Alembic (hand-written SQL), Caddy, React, vitest, pytest.

**Spec:** `docs/superpowers/specs/2026-11-24-connected-devices-design.md`

## Global Constraints
- Every route `Depends(guard())` (writes) or `guard(csrf=False)` (reads); authority through `policy.check` with new actions `view_sessions`, `revoke_sessions` (super admin only). Errors `{"error": code}`.
- Audit with `audit.log` (plain INSERT): `session_revoked`, `sessions_revoked_all`; no IP or user agent in `details`.
- Never expose `token_hash`; the public handle is `sessions.id` (uuid).
- Only unexpired, unrevoked sessions are listed. Last-seen write at most once per 5 minutes per session.
- Location is informational: sanitized (country `^[A-Z]{2}$`, city control characters removed, trimmed, 100 chars), rendered as text only.
- Migration `0011` is hand-written SQL, `app/models.py` kept in step, `kmk_app` grants checked by `test_schema_permissions.py`. (Documents uses `0012`; keep numbering in merge order, renumber if About/Documents land first. No migration in About.)
- Three locales, identical key sets. Commit trailer as usual.

## Review Focus
- A revoked session's cookie must stop working on the next request.
- Admin and user get 403; an unauthenticated or MFA-pending caller is refused (guard test).
- Revoking one's own current session logs the caller out (cookie cleared) without a 500.
- Missing/garbage Cloudflare headers (private IP, absent country, huge or control-character city) never break login or render markup.
- `last_seen` throttle: two requests within 5 minutes cause one write.

---

### Task 1: Migration and model

**Files:** Create `backend/alembic/versions/0011_session_devices.py`; modify `backend/app/models.py` (`UserSession`); test `backend/tests/test_schema_devices.py`.
**Interfaces:** Produces `UserSession.id` (uuid, unique, server default `gen_random_uuid()`), `last_seen_at` (timestamptz, default now), `last_ip` (text null), `country` (char(2) null), `city` (varchar(100) null).

- [ ] **Step 1: Failing test** `test_schema_devices.py`: after `alembic upgrade head` the five columns exist with those types; existing rows get an `id` and `last_seen_at`; `kmk_app` can UPDATE `last_seen_at, last_ip, country, city` (follow `test_schema_permissions.py` style).
- [ ] **Step 2:** `cd backend && .venv/bin/pytest tests/test_schema_devices.py -q`. Expected FAIL.
- [ ] **Step 3: Write 0011** as explicit SQL (`ALTER TABLE sessions ADD COLUMN ...`, `CREATE UNIQUE INDEX ... (id)`, backfill `last_seen_at = created_at`); downgrade drops them. Mirror in `models.py`. Re-migrate the test DB (`alembic upgrade head` with `MIGRATION_DATABASE_URL` for `kmk_test`, as earlier rounds did).
- [ ] **Step 4:** run the test and `tests/test_schema_permissions.py`. Expected PASS.
- [ ] **Step 5: Commit** `feat(devices): session columns`.

### Task 2: Recording last access and location

**Files:** Create `backend/app/auth/geo.py`, `backend/tests/test_geo.py`, `backend/tests/test_devices_recording.py`; modify `backend/app/auth/service.py` (`create_session`, `current_session`), `backend/app/auth/routes.py` (pass geo to login/session creation), `deploy/caddy/Caddyfile`.
**Interfaces:** Produces `geo.sanitize_country(raw: str | None) -> str | None`, `geo.sanitize_city(raw: str | None) -> str | None`, `geo.from_request(request: Request) -> tuple[str | None, str | None]` reading `X-Geo-Country`, `X-Geo-City`; `service.touch_session(db, session, ip, country, city) -> None` (conditional UPDATE, once per 5 minutes).

- [ ] **Step 1: Failing tests:** `sanitize_country("ca") == "CA"`, `("CAN") is None`, `("") is None`, `("T1") is None`; `sanitize_city("  Montr\x00éal\n ") == "Montréal"`, 300 chars truncated to 100, only control chars -> None; login stores `country`/`city`/`ip` from the headers; two authenticated requests within 5 minutes leave `last_seen_at` unchanged on the second (set it back 10 minutes in the DB and a request moves it).
- [ ] **Step 2:** run them. Expected FAIL.
- [ ] **Step 3: Implement.** `touch_session` is a single `UPDATE sessions SET last_seen_at=now(), last_ip=:ip, country=:c, city=:city WHERE token_hash=:h AND last_seen_at < now() - interval '5 minutes'` executed in the guard's lookup path (reuse the request's db session; commit with the request). Caddy: in the `/api/*` `reverse_proxy` block add `header_up X-Geo-Country {http.request.header.Cf-Ipcountry}` and `header_up X-Geo-City {http.request.header.Cf-Ipcity}` (overwrites anything the client sent under those names).
- [ ] **Step 4:** run new tests plus `tests/test_auth.py tests/test_mfa_guard.py`. Expected PASS.
- [ ] **Step 5: Commit** `feat(devices): record last access and location`.

### Task 3: Admin routes

**Files:** Create `backend/app/auth/devices.py`, `backend/tests/test_devices_api.py`; modify `backend/app/auth/policy.py` (actions), `backend/app/main.py`.
**Interfaces:** Produces `GET /api/admin/devices`, `DELETE /api/admin/devices/{id}` (uuid), `POST /api/admin/users/{user_id}/devices/logout-all`; response shapes as in the spec.

- [ ] **Step 1: Failing tests:** super admin lists sessions grouped by user with `current` true only for the caller's session and no `token_hash` anywhere; revoked and expired sessions absent; admin and user get 403; DELETE revokes (`revoked_at` set) and the revoked client's next `GET /api/auth/me` is 401; unknown or malformed id 404 `device_not_found`; DELETE of own current session returns 204 and clears the cookie; logout-all ends every session of the target (and 404 for an unknown user id); audit rows exist with no IP/UA in details; guard test lists the new routes.
- [ ] **Step 2:** run. Expected FAIL.
- [ ] **Step 3: Implement** routes with `Depends(guard())` / `guard(csrf=False)`, authority via `policy.check(actor, actor, "view_sessions"|"revoke_sessions")` (super admin only), queries filtered `revoked_at IS NULL AND expires_at > now()`, users ordered by name; reuse `avatar_url` helper from `app/auth/avatars_url.py`. Cache-Control no-store (path already under `/api/admin`).
- [ ] **Step 4:** run `tests/test_devices_api.py tests/test_mfa_guard.py tests/test_policy.py`. Expected PASS.
- [ ] **Step 5: Commit** `feat(devices): list and end sessions`.

### Task 4: Devices page

**Files:** Create `frontend/src/devices/{DevicesPage.tsx,devices.ts,DevicesPage.test.tsx,devices.test.ts,devices.css}`; modify `frontend/src/api.ts` (or `devices/api.ts`), `frontend/src/App.tsx` (route `/devices`), `frontend/src/app/Nav.tsx` (entry, super admin only), `frontend/src/locales/*.json`.
**Interfaces:** `parseUserAgent(ua: string | null): { browser: string; os: string }` (Chrome, Edge, Firefox, Safari, Opera / Windows, macOS, Linux, Android, iOS; unknown -> "Unknown"); `flagEmoji(country: string | null): string`; `relativeTime(iso: string, now: Date, locale: string): string` (via `Intl.RelativeTimeFormat`).

- [ ] **Step 1: Failing tests:** parser table (desktop Chrome/Windows, Safari/iOS, Firefox/Linux, Edge, garbage, null); `flagEmoji("CA")` is the two regional-indicator characters, `null` is empty; page groups by person, marks "This device", shows IP and location ("Local network" for private/absent), confirmation dialog before Sign out (cancel does nothing, confirm calls DELETE), per-person "Sign out all devices"; nav entry hidden for admin/user and visible for super admin; the explanatory note (does not block) is present.
- [ ] **Step 2:** run. Expected FAIL.
- [ ] **Step 3: Implement** with the existing `Dialog`, `Avatar`, `PageHeader` and Tasks-style rows; locale keys prefixed `device*`; add `/devices` to the route table with the non-super-admin redirect used by the Users page.
- [ ] **Step 4:** `npx vitest run && npx tsc --noEmit && npm run build`. Expected PASS.
- [ ] **Step 5: Commit** `feat(devices): Devices page`.

### Task 5: Docs

**Files:** modify `docs/README.md`, `docs/security.md` (sessions, audit actions, location caveat), `docs/operations.md` (turn on Cloudflare "Add visitor location headers"; Caddy restart needed), `CLAUDE.md` layout line if needed.

- [ ] **Step 1:** write the docs. **Step 2:** run the whole frontend suite and the backend suite once (background, alone). Expected: all pass. **Step 3: Commit** `docs: connected devices`.
