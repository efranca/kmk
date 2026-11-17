# kmk Phase 4a (TOTP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optional (encouraged, not forced) TOTP two-step login with recovery codes, an enforcement switch for later, a reset command, the screens for it, and a documentation set for the whole project.

**Architecture:** One FastAPI dependency, `guard(allow, csrf)`, protects every non-public route and decides, from a per-request MFA state (`ok` / `verify` / `setup`), what a session may call. A login always creates a session; for users with TOTP it stays `verify` until the code is accepted. TOTP secrets are Fernet-encrypted with a key from `deploy/.env`. New `app/mfa.py` (pure primitives), `app/auth/mfa_service.py` (database-facing), `app/auth/mfa_routes.py` (endpoints). The React app gains verify, enroll, recovery-code and security screens plus a nudge banner.

**Tech Stack:** as phases 1-3, plus `pyotp`, `cryptography` (backend) and `qrcode` (frontend).

**Spec:** `docs/superpowers/specs/2026-11-17-phase4a-totp-design.md` (also `scope.md` §5 and the phase 2/3 designs)

## Global Constraints

- All phase 2/3 Global Constraints still hold (kmk_app runtime role and INSERT-only audit log without RETURNING, Origin check on mutating `/api` requests, per-session CSRF token via `X-CSRF-Token`, `Cache-Control: no-store` on `/api/auth` and `/api/admin`, tests only on `kmk_test`, commit trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`, secrets only in git-ignored `.env` files and never echoed).
- New settings in `app.config.Settings`: `mfa_encryption_key: str | None = None` (a Fernet key), `mfa_required_roles: str = ""` (comma-separated roles; property `required_roles -> set[str]`), `mfa_issuer: str = "KMK Entretien"`. Empty `mfa_required_roles` means nobody is forced (default for this phase).
- TOTP parameters: SHA-1, 6 digits, 30 s step, codes accepted for the previous, current and next step; the matched step must be greater than `users.mfa_last_step`. Recovery codes: 10 per set, form `xxxxx-xxxxx`, alphabet `23456789abcdefghjkmnpqrstuvwxyz`, stored as SHA-256 hex of the normalized (lower-case, no dashes/spaces) code, single use.
- MFA states: `ok`, `verify` (user has TOTP, `sessions.mfa_verified` false), `setup` (role in `required_roles` and TOTP not enabled). Rejections: `403 {"error": "mfa_required"}` (verify), `403 {"error": "mfa_setup_required"}` (setup). Other errors: wrong code `403 {"error": "invalid_code"}`, wrong password `403 {"error": "invalid_current_password"}`, refused disable `403 {"error": "mfa_mandatory"}`, already enabled `409 {"error": "already_enabled"}`, nothing pending `409 {"error": "no_pending_setup"}`, no key configured `503 {"error": "mfa_unavailable"}`, limited `429 {"error": "too_many_attempts"}`.
- Rate limit kind `mfa`: failed code/password checks counted per username and per IP with the existing `rl_*` settings.
- No TOTP secret, code, recovery code, or hash in logs, audit rows, or any response other than the one-time ones named in the spec. Audit actions: `mfa_enrolled`, `mfa_verified`, `mfa_failed`, `recovery_code_used`, `recovery_codes_regenerated`, `mfa_disabled`, `mfa_reset`.
- **Rulings at plan time:** (1) `mfa_required_roles` is a comma-separated string, not a JSON list, so it is easy to set in `.env`; (2) the guard is a FastAPI dependency, so existing handlers in `routes.py`, `account.py` and `admin.py` are refactored to receive `(user, session)` from it (behavior unchanged); (3) the login and `/me` responses gain `mfa` and `mfa_enabled` fields, additively; (4) enabling TOTP revokes the user's other sessions; (5) the documentation task covers the whole project (phases 1-4a), not only this phase; (6) the frontend treats a missing `mfa` field as `"ok"` so older mocks and responses keep working.
- Phase 1-3 tests must stay green.

## Review Focus

- Every protected route rejects a `verify`-state session (and, with enforcement on, a `setup`-state one) before body validation; a test exercises all routes so a forgotten guard fails the suite (Task 2).
- Codes cannot be replayed, are accepted only inside the ±1-step window, and wrong guesses are rate limited and audited; recovery codes work once, case- and dash-insensitively, and regenerating invalidates the old set (Tasks 1 and 3).
- TOTP secrets are stored as Fernet tokens (never the base32 secret); no secret, code or recovery code reaches audit rows or logs; without `MFA_ENCRYPTION_KEY` the MFA endpoints answer `503` while ordinary login still works (Task 3).
- The enforcement switch works in both positions: default nobody is forced (an admin without TOTP behaves as before); with `admin,superadmin` such an admin can only enroll, read `/me`, and sign out, and cannot disable TOTP (Tasks 2 and 3).
- The documentation matches the running system: every command, port, path and variable it mentions was checked against the repo (Task 6).

---

### Task 1: Schema, settings and MFA primitives

**Files:**
- Create: `backend/alembic/versions/0004_mfa.py`, `backend/app/mfa.py`
- Modify: `backend/app/models.py`, `backend/app/config.py`, `backend/pyproject.toml` (add `pyotp>=2.9`, `cryptography>=43`), `backend/tests/conftest.py` (`clean_db` also truncates `recovery_codes`; helpers below)
- Test: `backend/tests/test_mfa_primitives.py`, `backend/tests/test_schema_permissions.py` (extend)

**Interfaces:**
- Produces:
  - Migration `0004`: `users.mfa_last_step bigint null`; `sessions.mfa_verified boolean not null default true`; table `recovery_codes(id bigint identity PK, user_id bigint FK users, code_hash varchar(64) unique not null, created_at timestamptz default now(), used_at timestamptz null)` with an index on `user_id`; `login_attempts_kind_valid` check now also allows `'mfa'`; `GRANT SELECT, INSERT, UPDATE, DELETE ON recovery_codes TO kmk_app`.
  - Models: `User.mfa_last_step`, `UserSession.mfa_verified`, `RecoveryCode`.
  - `Settings.required_roles` property (`{"admin","superadmin"}` for `"admin, superadmin"`, empty set for `""`).
  - `app.mfa` (pure, no database): `new_secret() -> str` (base32); `provisioning_uri(secret: str, username: str, issuer: str) -> str` (`otpauth://totp/...`); `encrypt_secret(secret: str, key: str) -> str` and `decrypt_secret(token: str, key: str) -> str` (Fernet; wrong key raises `ValueError`); `now() -> float` (wraps `time.time()` so tests can patch it); `matching_step(secret: str, code: str, last_step: int | None) -> int | None` (strips spaces; accepts steps `now()//30 + {-1, 0, 1}`; returns the matching step only if it is greater than `last_step`, else `None`); `new_recovery_codes(count: int = 10) -> list[str]`; `normalize_recovery_code(code: str) -> str`; `hash_recovery_code(code: str) -> str`.
  - `tests/conftest.py` fixtures/helpers: `mfa_key` (a generated Fernet key; also set on test settings via `make_settings(mfa_encryption_key=...)` default in `helpers.make_settings`), `add_mfa_user(username, ..., role="user") -> str` returning the plaintext TOTP secret after inserting the user with `mfa_enabled = true`, the encrypted secret and 10 recovery codes (returned through the fixture's `.codes[username]`), and `totp(secret, offset=0) -> str` producing the code for `now()//30 + offset`.

- [ ] **Step 1: Write the tests first**
  - `test_mfa_primitives.py`: encrypt/decrypt round-trip and `ValueError` for a wrong key; the stored token does not contain the secret; `provisioning_uri` contains the issuer, the username and `secret=`; `matching_step` accepts offsets -1/0/1 and rejects -2/+2 (patch `app.mfa.now` to a fixed value), rejects a step `<= last_step`, rejects non-digit, short and empty codes; `new_recovery_codes` gives 10 unique codes of form `xxxxx-xxxxx` using only the alphabet; `normalize_recovery_code("ABCDE-fgh23")` equals `"abcdefgh23"` and removes spaces; `hash_recovery_code` is stable and 64 hex characters and equal for dashed/undashed/upper/lower input; `Settings.required_roles` parsing.
  - Extend `test_schema_permissions.py`: `kmk_app` has full DML on `recovery_codes`; duplicate `code_hash` is rejected; `login_attempts.kind='mfa'` is accepted; new `sessions` rows default `mfa_verified` to true.
- [ ] **Step 2: Run to watch them fail** — `cd backend && .venv/bin/pip install -q -e '.[dev]' && .venv/bin/pytest -q` → new tests FAIL/ERROR.
- [ ] **Step 3: Implement** the migration, models, settings and `app/mfa.py` to the Interfaces; add the conftest helpers (`add_mfa_user` uses `owner_engine` and `app.mfa`).
- [ ] **Step 4: Run the whole suite** → all pass.
- [ ] **Step 5: Commit** `feat(mfa): schema, settings and TOTP primitives`.

---

### Task 2: Session states, the guard, and login/me changes

**Files:**
- Create: `backend/app/auth/guard.py`
- Modify: `backend/app/auth/routes.py` (login, me, logout use the guard; `login` creates sessions with `mfa_verified`), `backend/app/auth/service.py` (`create_session(..., mfa_verified: bool = True)`, `mfa_state`), `backend/app/auth/account.py` (change-password), `backend/app/auth/admin.py` (`admin_actor`), `backend/app/main.py` (nothing new unless needed)
- Test: `backend/tests/test_mfa_guard.py`, existing auth/account/admin tests must pass unchanged

**Interfaces:**
- Consumes: Task 1 models/settings/helpers; phase 2/3 `routes.get_db`, `get_settings_dep`, `request_ip`, `service`.
- Produces:
  - `service.mfa_state(user: User, session: UserSession, settings: Settings) -> str` returning `"verify"` when `user.mfa_enabled and not session.mfa_verified`, `"setup"` when `not user.mfa_enabled and user.role in settings.required_roles`, else `"ok"`.
  - `service.create_session(db, user, settings, ip, user_agent, mfa_verified: bool = True)`; login passes `mfa_verified = not user.mfa_enabled`.
  - `guard.guard(*, allow: tuple[str, ...] = ("ok",), csrf: bool = True) -> Callable` returning a FastAPI dependency that yields `(User, UserSession)`: `401 unauthenticated` without a valid session, `403 forbidden` for a bad/missing CSRF token (when `csrf`), then `403 mfa_required` / `403 mfa_setup_required` when the state is not in `allow`. `routes.require_auth` is replaced by it.
  - Usage: `GET /api/auth/me` and `POST /api/auth/logout` use `guard(allow=("ok","verify","setup"), csrf=<False for me, True for logout>)`; `change-password` and `admin_actor` use the default `guard()`.
  - Login and `/me` responses add `"mfa": <state>` and `"mfa_enabled": <bool>` (existing keys unchanged).

- [ ] **Step 1: Write `test_mfa_guard.py` first** (helpers from Task 1; `make_client(mfa_required_roles=...)`):
  - `test_login_state_fields`: a user without TOTP → login/`me` show `"mfa": "ok"`, `"mfa_enabled": false`; a user with TOTP → login shows `"mfa": "verify"`, `"mfa_enabled": true` and the session row has `mfa_verified = false`; users without TOTP get `mfa_verified = true`.
  - `test_verify_state_blocks_every_protected_route`: with a `verify`-state session (CSRF token and Origin supplied, body `{}`), enumerate `client.app.routes`, keep those with a path starting `/api`, replace `{param}` with `1`, skip `PUBLIC = {("GET","/api/health"), ("POST","/api/auth/login"), ("POST","/api/auth/forgot-password"), ("POST","/api/auth/set-password")}` and `ALLOWED = {("GET","/api/auth/me"), ("POST","/api/auth/logout"), ("POST","/api/auth/mfa/verify")}`; every other (method, path) must answer exactly `403 {"error": "mfa_required"}`. The test also fails if the enumeration finds fewer than a sane minimum of routes, so it cannot pass vacuously. (Routes added by Task 3 are covered automatically once they exist.)
  - `test_setup_state_with_enforcement`: with `mfa_required_roles="admin,superadmin"`, an `admin` without TOTP: `/me` → `200` with `"mfa": "setup"`; logout `204`; every other protected route except `("POST","/api/auth/mfa/setup")` and `("POST","/api/auth/mfa/enable")` answers `403 {"error": "mfa_setup_required"}`; a plain `user` with the same setting is `ok`.
  - `test_default_settings_force_nobody`: default settings, admin without TOTP: login `"mfa": "ok"`, `POST /api/admin/users` is reachable (not 403 mfa_*), `change-password` works as before.
  - `test_verify_state_can_still_read_me_and_logout`: `/me` returns `200` (state `verify`), logout `204`.
  - Existing phase 2/3 tests are the regression suite for the refactor.
- [ ] **Step 2: Run to watch them fail** — `cd backend && .venv/bin/pytest tests/test_mfa_guard.py -q` → FAIL.
- [ ] **Step 3: Implement** `guard.py` and the refactors to the Interfaces; handlers take `(user, session)` from `Depends(guard(...))`; no behavior change for users without TOTP.
- [ ] **Step 4: Run the whole suite** → all pass (the route test passes now with the three allowed routes and no MFA routes yet).
- [ ] **Step 5: Commit** `feat(mfa): per-request MFA state and a guard on every protected route`.

---

### Task 3: MFA endpoints

**Files:**
- Create: `backend/app/auth/mfa_service.py`, `backend/app/auth/mfa_routes.py`
- Modify: `backend/app/main.py` (include the router)
- Test: `backend/tests/test_mfa_routes.py`

**Interfaces:**
- Consumes: Tasks 1-2; `ratelimit`, `audit`, `security.verify_password`.
- Produces (router prefix `/api/auth/mfa`, all POST, CSRF + Origin required; `503 mfa_unavailable` when `settings.mfa_encryption_key` is unset):
  - `mfa_service.verify_totp(db, user, code: str, settings) -> bool`: decrypts `user.mfa_secret`, `mfa.matching_step(...)`, then atomically `UPDATE users SET mfa_last_step = :step WHERE id = :id AND (mfa_last_step IS NULL OR mfa_last_step < :step)` and returns true only when one row changed.
  - `mfa_service.issue_recovery_codes(db, user) -> list[str]` (deletes the user's old codes, stores hashes of 10 new ones); `consume_recovery_code(db, user, code) -> bool` (atomic `UPDATE recovery_codes SET used_at = now() WHERE user_id = :u AND code_hash = :h AND used_at IS NULL`); `remaining_recovery_codes(db, user) -> int`; `revoke_other_sessions(db, user_id, keep_token_hash)`.
  - `POST /setup` (guard `allow=("ok","setup")`): `409 already_enabled` if enabled; stores a fresh encrypted pending secret (`mfa_enabled` stays false); returns `{"secret", "otpauth_uri"}`.
  - `POST /enable {code}` (allow `ok`,`setup`): `409 no_pending_setup` without a pending secret; wrong code `403 invalid_code` (audit `mfa_failed`, rate limited); success sets `mfa_enabled`, `mfa_last_step`, issues codes, marks the current session `mfa_verified`, revokes other sessions, audit `mfa_enrolled`; returns `{"recovery_codes": [...]}`.
  - `POST /verify {code}` or `{recovery_code}` (allow `verify`; exactly one field, else `422`): success sets the session's `mfa_verified`, audit `mfa_verified` (or `recovery_code_used`); response `{"status": "ok", "recovery_codes_remaining": int}`; wrong `403 invalid_code` + audit `mfa_failed`.
  - `POST /disable {password, code}` (allow `ok`): `403 mfa_mandatory` when the user's role is in `required_roles`; wrong password `403 invalid_current_password`; wrong code `403 invalid_code`; success clears secret, `mfa_enabled`, `mfa_last_step`, recovery codes, revokes other sessions, audit `mfa_disabled`; `200 {"status": "ok"}`.
  - `POST /recovery-codes/regenerate {password, code}` (allow `ok`, requires TOTP enabled else `409 not_enabled`): password and code checks as above; returns `{"recovery_codes": [...]}`, audit `recovery_codes_regenerated`.
  - Every failed password/code check is recorded with `ratelimit.record_attempt(..., kind="mfa")` for the username; `is_limited(..., kind="mfa")` is checked first and answers `429 too_many_attempts`.

- [ ] **Step 1: Write `test_mfa_routes.py` first** (use `pyotp`, `totp()`/`add_mfa_user` from Task 1; patch `app.mfa.now` to step the clock 30 s between uses of the same secret):
  - enrollment: `setup` returns a secret and an `otpauth://` URI; the database holds a Fernet token for it (`mfa_secret` neither equals nor contains the base32 secret) and `mfa_enabled` is still false; calling `setup` again replaces the pending secret; `enable` with a wrong code → `403 invalid_code` and nothing enabled; with the right code → `200`, 10 well-formed recovery codes, `mfa_enabled` true, other sessions of the user revoked and the current one still `ok`; `setup` afterwards → `409 already_enabled`; `enable` without a pending secret → `409 no_pending_setup`.
  - login with TOTP: password then `/me` shows `verify`; `verify` with a correct code → `ok` state and `/api/auth/change-password` is reachable; a wrong code → `403 invalid_code`; the same correct code used a second time (another login within the same step) → rejected (replay); a code from the previous step is accepted once (window) and a code two steps old is rejected.
  - recovery codes: a code logs in once and the second use fails; uppercase, with/without dash, with spaces all work; `recovery_codes_remaining` decreases; `regenerate` invalidates every old code and returns 10 new ones; regenerate needs a password and a code (wrong password → `403 invalid_current_password`, wrong code → `403 invalid_code`, not enabled → `409`).
  - disable: needs password and code; success clears the secret, `mfa_enabled`, codes, and revokes other sessions; with `mfa_required_roles="admin,superadmin"` an admin gets `403 mfa_mandatory` while a plain user can disable.
  - rate limit: after `rl_identifier_max` wrong codes the next attempt (even a correct one) → `429 too_many_attempts`; each failure wrote an `mfa_failed` audit row.
  - no key: with `mfa_encryption_key=None` every MFA endpoint → `503 mfa_unavailable`, while a user without TOTP can still log in and use `change-password`.
  - secrets hygiene: after a full enroll → verify → regenerate → disable run, the audit table and `caplog` contain none of the base32 secret, any TOTP code, any recovery code, or any recovery-code hash.
  - the route enumeration test from Task 2 still passes with the new routes (the five new routes must answer `403 mfa_required` to a `verify` session except `/verify`).
- [ ] **Step 2: Run to watch them fail** — `cd backend && .venv/bin/pytest tests/test_mfa_routes.py -q` → FAIL.
- [ ] **Step 3: Implement** to the Interfaces.
- [ ] **Step 4: Run the whole suite** → all pass.
- [ ] **Step 5: Commit** `feat(mfa): enroll, verify, disable and recovery-code endpoints`.

---

### Task 4: `reset-mfa` command

**Files:**
- Modify: `backend/app/cli.py`
- Test: `backend/tests/test_cli.py` (extend)

**Interfaces:**
- Consumes: Task 1-3 models.
- Produces: `python -m app.cli reset-mfa --username U` (exit `0` done, `1` unknown user): clears `mfa_secret`, `mfa_enabled`, `mfa_last_step`, deletes the user's recovery codes, revokes all their sessions, writes audit `mfa_reset` (actor null, details `{"via": "cli"}`), prints a confirmation without secrets.

- [ ] **Step 1: Write the tests first:** a user with TOTP, codes and two sessions is reset: all fields cleared, codes gone, sessions revoked, one `mfa_reset` audit row, exit `0`; the user can log in with the password alone afterwards; an unknown username exits `1`; output contains no secret.
- [ ] **Step 2: Run to watch them fail** — `cd backend && .venv/bin/pytest tests/test_cli.py -q` → FAIL.
- [ ] **Step 3: Implement** the subcommand (same style as `create-superadmin`).
- [ ] **Step 4: Run the whole suite** → all pass.
- [ ] **Step 5: Commit** `feat(cli): reset-mfa command`.

---

### Task 5: Frontend screens

**Files:**
- Create: `frontend/src/MfaVerify.tsx`, `frontend/src/MfaSetup.tsx`, `frontend/src/RecoveryCodes.tsx`, `frontend/src/SecuritySection.tsx`, `frontend/src/MfaBanner.tsx`
- Modify: `frontend/package.json` (add `qrcode`, `@types/qrcode`), `frontend/src/api.ts`, `frontend/src/App.tsx`, `frontend/src/SignedIn.tsx`, `frontend/src/locales/{fr-CA,en,pt-BR}.json`, `frontend/src/index.css`
- Test: `frontend/src/Mfa.test.tsx` (new); existing tests keep passing

**Interfaces:**
- Consumes: Task 2/3 endpoints and fields.
- Produces:
  - `api.ts`: `type MfaState = "ok" | "verify" | "setup"`; `Session` gains `mfa: MfaState` and `mfaEnabled: boolean` (`me()` and `login()` map `body.mfa ?? "ok"`, `body.mfa_enabled ?? false`); new calls (all send `X-CSRF-Token`, JSON bodies, `credentials: "same-origin"`): `mfaSetup(csrf): Promise<{secret: string; otpauthUri: string} | null>`; `mfaEnable(csrf, code): Promise<{ok: true; recoveryCodes: string[]} | {ok: false; reason: "invalid_code" | "rate_limited" | "unavailable" | "network"}>`; `mfaVerify(csrf, input: {code: string} | {recoveryCode: string}): Promise<{ok: true; remaining: number} | {ok: false; reason: "invalid_code" | "rate_limited" | "network"}>`; `mfaDisable(csrf, password, code)` and `mfaRegenerate(csrf, password, code)` returning `{ok: true; recoveryCodes?: string[]} | {ok: false; reason: "wrong_password" | "invalid_code" | "mandatory" | "rate_limited" | "network"}`.
  - Screens: `verify` state → `MfaVerify` (code field, toggle to a recovery-code field, sign-out link). `setup` state → `MfaSetup` (no way to skip except signing out). In the `ok` state `SignedIn` shows `MfaBanner` when `mfaEnabled` is false (permanent for roles `admin`/`superadmin`; dismissible for `user`, remembered in `localStorage` key `kmk.mfaBannerDismissed`, every storage access in try/catch) and `SecuritySection` (not enabled: an "Enable two-step verification" button opening `MfaSetup`; enabled: status, regenerate codes and disable, each asking for password and code). `MfaSetup` renders the QR code with `QRCode.toDataURL(otpauthUri)` into an `<img>`, shows the secret as text, takes the 6-digit code, then `RecoveryCodes` (list, Copy button via `navigator.clipboard.writeText`, Download as `.txt` via a Blob, and a required "I saved them" checkbox enabling Continue). After enabling, the session in state becomes `mfaEnabled: true, mfa: "ok"`.
  - Locale keys, identical in all three files: `mfaCodeTitle`, `mfaCode`, `mfaVerify`, `useRecoveryCode`, `useAuthenticatorCode`, `recoveryCode`, `invalidCode`, `mfaSetupTitle`, `mfaSetupIntro`, `mfaSecretLabel`, `mfaEnable`, `recoveryCodesTitle`, `recoveryCodesIntro`, `copyCodes`, `downloadCodes`, `savedCodes`, `continue`, `mfaBannerAdmin`, `mfaBannerUser`, `dismiss`, `securityTitle`, `mfaStatusOn`, `mfaStatusOff`, `regenerateCodes`, `disableMfa`, `mfaMandatory`, `mfaUnavailable`, `codesRemaining` (uses `{{count}}`).

- [ ] **Step 1: Write `Mfa.test.tsx` first** (mock `fetch` like the earlier tests; `vi.mock("qrcode", ...)` so `toDataURL` resolves to `"data:image/png;base64,AAAA"`):
  - login answering `mfa: "verify"` shows the code screen; submitting posts `/api/auth/mfa/verify` with `{code}` and the CSRF header and then shows the signed-in page; a `403` shows `invalidCode`; the toggle switches to the recovery-code field and posts `{recovery_code}`.
  - banner: `mfa_enabled: false`, role `user` shows `mfaBannerUser` with a dismiss button that hides it and persists (a second render stays hidden); role `admin` shows `mfaBannerAdmin` with no dismiss button; `mfa_enabled: true` shows no banner.
  - enrollment: clicking enable calls `/api/auth/mfa/setup`, shows the secret text and an image with the data URL; entering a code calls `/api/auth/mfa/enable`; the recovery codes appear; Continue stays disabled until the checkbox is ticked; afterwards the security section shows `mfaStatusOn` and the banner is gone.
  - forced `setup` state shows the enrollment page directly with no way to skip except signing out.
  - security section when enabled: regenerate sends password and code and shows the new codes; disable sends them and returns to `mfaStatusOff`; a `403 mfa_mandatory` shows `mfaMandatory`; a `503` from enable/setup shows `mfaUnavailable`.
  - locale parity for the new keys in all three files.
- [ ] **Step 2: Run to watch them fail** — `cd frontend && npm install qrcode && npm install -D @types/qrcode && npx vitest run` → new tests FAIL.
- [ ] **Step 3: Implement** the files above in the KMK look (existing CSS tokens), usable at phone width and in dark mode; `inputMode="numeric"` and `autoComplete="one-time-code"` on the code field.
- [ ] **Step 4: Run tests and build** — `cd frontend && npx vitest run && npm run build` → all pass.
- [ ] **Step 5: Commit** `feat(frontend): two-step verification screens`.

---

### Task 6: Documentation set

**Files:**
- Create: `README.md`, `CLAUDE.md`, `docs/README.md`, `docs/operations.md`, `docs/security.md`, `docs/roadmap.md`
- Modify: `scope.md` (add one line at the top pointing to `docs/README.md` and stating that `docs/` describes what is actually built)

**Interfaces:**
- Consumes: the repository, the running stack, and every spec and plan under `docs/superpowers/`.
- Produces: the documentation described in the spec's "Documentation deliverable". Write it from the code as it is; verify each fact before writing it.

- [ ] **Step 1: Gather the facts (read-only).** List what actually exists: `git log --oneline`, the tree under `backend/app`, `backend/tests`, `frontend/src`, `deploy/`; the routes (`grep` the routers or print `app.routes`); the CLI subcommands (`python -m app.cli --help` and each subcommand's `--help`); every setting in `app/config.py` and every variable in `deploy/.env.example`; the migrations in `backend/alembic/versions`; the compose file, Caddyfile, ports, volumes, database roles and names; the test commands and counts (`pytest -q`, `vitest run`).
- [ ] **Step 2: Write the documents** with these contents:
  - `README.md`: what the app is (internal app for KMK Entretien Ménager, https://app.kmk-entretien.ca), the stack, the repository layout, how to run the backend tests and the frontend tests and build, how it is served (Cloudflare Tunnel to Caddy on 127.0.0.1:8081, API on 127.0.0.1:8001, shared Postgres on 127.0.0.1:5432), and a pointer to `docs/README.md`.
  - `CLAUDE.md`: guidance for future coding sessions: what the project is; layout; the exact commands to test, build, migrate and deploy; conventions (TDD, `kmk_app` role cannot read the audit log so audit writes use plain INSERT, every protected route uses `guard`, new routes need classification in the route test, tests only on `kmk_test`, secrets only in `.env` and never echoed or committed); where specs, plans and the ledger live (`docs/superpowers/specs`, `docs/superpowers/plans`, `.superpowers/` is git-ignored scratch); workflow note that design is brainstormed and approved before planning, and that the user performs Cloudflare and Resend dashboard steps and runs password prompts themselves.
  - `docs/README.md`: index; a diagram-in-text of the request path (browser, Cloudflare, tunnel, Caddy, API, Postgres); a status table of the phases (1 foundation, 2 core auth, 3 account flows, 4a TOTP: done; 4b admin page and role rules, 5 frontend polish and welcome page, 6 hardening: next) with links to each spec and plan; the data model as built (tables and key columns); the API endpoint table (method, path, who may call it, state required).
  - `docs/operations.md`: the runbook: start/stop/rebuild commands; `deploy/.env` variables each explained with defaults and which are secrets; database roles (`kmk`, `kmk_app`, `kmk_test`) and how migrations run (container start) and how to run them by hand; creating the first super admin and `reset-mfa`; backups (what `pg-backup.sh` covers, that the `.env` and especially `MFA_ENCRYPTION_KEY` are not in it and must be saved separately, restore notes); switching email from `log` to Resend (steps, `docker logs` to read dev links); enabling MFA enforcement (`MFA_REQUIRED_ROLES=admin,superadmin`, effect, how to undo); the Cloudflare settings that matter (tunnel route `app` to `http://localhost:8081`, Always Use HTTPS); host requirements (correct clock for TOTP); a troubleshooting table of symptoms seen so far (for example Caddy needs a restart after a Caddyfile change, `pg-new-db.sh` needs its `.env`).
  - `docs/security.md`: the model as implemented: transport (Cloudflare to tunnel, loopback hops), passwords (Argon2id, rules), sessions (server-side, 5 days, cookie flags, revocation events), CSRF (SameSite, Origin check, per-session token), real client IP handling, rate limits (kinds, numbers, window), generic errors and timing, tokens (invite/reset), email layer, MFA (parameters, encryption, replay protection, recovery codes, states, enforcement switch), audit log (append-only role, events written), headers/CSP, secrets handling; a section "Accepted risks and limits" (lockout by spamming a name, dev email backend logs links, single host, no key rotation, shared Postgres) and one "What is not covered yet".
  - `docs/roadmap.md`: next phases with their scope from `scope.md`; items built but switched off (MFA enforcement); deferred minors collected from every phase; parked risks from `scope.md` §12; open items from `scope.md` §14 and their status (super admin created, sender address, welcome copy, regulation and backup reviews); suggestions for hardening in phase 6 (HSTS preload, a restore test, dependency scanning, a fresh independent security review).
- [ ] **Step 3: Verify the docs against the system.** For every command, path, port and variable the documents mention, check it exists (grep the repo, run `--help`, `ss -ltn`, `docker ps`); fix any mismatch in the documents. Confirm every link between documents resolves to an existing file. Confirm the documents contain no secrets (no passwords, keys, tokens, or the real `.env` values).
- [ ] **Step 4: Commit** `docs: README, CLAUDE.md and the docs set`.

---

### Task 7: Deploy and verify live

**Files:**
- Modify: `deploy/.env` (untracked), `deploy/.env.example`

**Interfaces:**
- Consumes: everything above.
- Produces: the live optional TOTP feature; a handoff for the user to try it.

- [ ] **Step 1: Key and settings:** generate a Fernet key with `backend/.venv/bin/python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` and append `MFA_ENCRYPTION_KEY=<key>` to `deploy/.env` without printing it; append commented lines for `MFA_REQUIRED_ROLES` (with the explanation "empty = nobody forced; `admin,superadmin` forces them") to `deploy/.env.example` and a placeholder `MFA_ENCRYPTION_KEY=change-me` with the generation command in a comment. Commit the example only.
- [ ] **Step 2: Deploy:** `cd frontend && npm run build`; `cd deploy && docker compose up -d --build`.
Expected: `kmk-api` starts, migration `0004` applied (`select version_num from alembic_version` → `0004`), no errors in `docker logs kmk-api`.
- [ ] **Step 3: Verify through Caddy** (do not touch the real account):

```bash
H='Host: app.kmk-entretien.ca'; B=http://127.0.0.1:8081; O='Origin: https://app.kmk-entretien.ca'; J='Content-Type: application/json'
curl -s -H "$H" $B/api/health                                                                           # {"status":"ok"}
curl -s -o /dev/null -w 'me %{http_code}\n' -H "$H" $B/api/auth/me                                      # 401
for p in setup enable verify disable recovery-codes/regenerate; do
  curl -s -o /dev/null -w "$p %{http_code}\n" -H "$H" -H "$O" -H "$J" -d '{}' $B/api/auth/mfa/$p; done   # 401 for each (anonymous)
curl -s -w ' %{http_code}\n' -H "$H" -H "$O" -H "$J" -d '{"identifier":"nobody","password":"x"}' $B/api/auth/login   # invalid_credentials 401 (unchanged)
docker exec postgres psql -U postgres -d kmk -Atc "select version_num from alembic_version"              # 0004
docker exec postgres psql -U postgres -d kmk -Atc "select count(*) from recovery_codes"                  # 0
docker exec kmk-api id -u                                                                                # not 0
docker ps --format '{{.Names}}' | grep -E 'famillai|^postgres$'                                         # all running
```

- [ ] **Step 4: Hand off to the user** (their phone, their browser; do not request or handle their password or codes): (a) sign in, see the "enable two-step verification" banner, click enable, scan the QR with their authenticator app, enter the code, save the recovery codes somewhere safe; (b) sign out and sign in again with a code; (c) try a recovery code once on a later sign-in; (d) copy `MFA_ENCRYPTION_KEY` from `deploy/.env` into their password manager (`grep MFA_ENCRYPTION_KEY /home/evandro/projects/kmk/deploy/.env`), because the database backups do not include it; (e) read `docs/operations.md` for how to enforce MFA later and how to recover with `reset-mfa`.
- [ ] **Step 5: Commit** `feat(deploy): MFA settings`.
