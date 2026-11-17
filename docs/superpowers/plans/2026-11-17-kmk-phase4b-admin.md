# kmk Phase 4b (Admin) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin page and the user lifecycle behind it (list, invite with role, edit, disable/enable, delete/restore, role change, reset password and two-step), governed by one central authority policy in which only the super admin manages admins.

**Architecture:** `app/auth/policy.py` (pure authority rules and the per-row `available_actions`), `app/auth/lifecycle.py` (database changes: state machine, session revocation, last-admin invariant), and the existing `app/auth/admin.py` router extended to call them in that order: policy check, lifecycle change, audit, commit. The React app gains an `/admin` page that only renders the actions the server lists. No schema change.

**Tech Stack:** as phases 1-4a; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-17-phase4b-admin-design.md` (also `docs/roadmap.md` and the phase 2-4a designs)

## Global Constraints

- All earlier Global Constraints hold: every route behind `guard`, Origin + `X-CSRF-Token` on mutating requests, `Cache-Control: no-store` on `/api/admin`, the `kmk_app` role cannot read the audit log (write it with `audit.log`, never `RETURNING`), tests only on `kmk_test` with `NullPool` apps, secrets never in logs/audit rows, strings in all three locales, commit trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Admin endpoints need a fully verified session (two-step state `ok`) and role `admin` or `superadmin`. With the default settings an admin without TOTP is state `ok`.
- **Authority (the single source of truth, `policy.py`):** checks run in this order: (1) the actor's role must be `admin` or `superadmin`, else `403 {"error": "forbidden"}`; (2) for the actions `disable`, `delete`, `set_role`, `reset_mfa` the actor may not be the target, else `403 {"error": "cannot_target_self"}`; (3) the matrix: target `superadmin`: only `view`, plus `reset_password` by the super admin on themselves; target `admin`: every action, but only for an actor with role `superadmin`; target `user`: every action for `admin` and `superadmin`. `set_role` is super-admin-only, moves only between `user` and `admin`, never to or from `superadmin`. Inviting a new account with role `admin` is super-admin-only; role `superadmin` can never be created through the API.
- **Actions** (strings used by the API and the UI): `view`, `edit`, `resend_invite`, `reset_password`, `reset_mfa`, `disable`, `enable`, `delete`, `restore`, `set_role`.
- **State machine (`users.status`):** `disable`: `invited` or `active` → `disabled`; `enable`: `disabled` → `invited` if `password_hash` is null else `active`; `delete`: `invited`, `active` or `disabled` → `deleted` (sets `deleted_at`, marks the user's unused tokens used); `restore`: `deleted` → `disabled` (clears `deleted_at`). Any other source state: `409 {"error": "invalid_state"}`. `resend_invite` needs `invited`; `reset_password` needs `active` (`409 not_active`, as today); `reset_mfa` needs TOTP enabled (`409 not_enabled`); `edit` and `set_role` are refused for `deleted` accounts (`409 invalid_state`).
- **Session effects:** disable, delete, role change and two-step reset revoke all of the target's sessions (`sessions.revoked_at = now()`).
- **Last-admin invariant:** demoting, disabling or deleting an `admin`/`superadmin` that is `active` is refused with `409 {"error": "last_admin"}` if no other `active` user with role `admin` or `superadmin` would remain; the privileged rows are locked (`SELECT ... FOR UPDATE`) in the same transaction as the change.
- **Edit rules:** `PATCH` accepts `locale` (`fr-CA`/`en`/`pt-BR`) at any time and `email` only while the target is `invited`; email is lowercased and format-checked as at invite; duplicate `409 already_exists`; empty body `422`.
- **List:** `GET /api/admin/users` → `{"users": [...]}` sorted by username, each `{id, username, email, role, locale, status, mfa_enabled, created_at, last_sign_in (ISO string of the newest session start, or null), actions: [...]}`; includes deleted accounts. Uses `guard(csrf=False)`.
- **Audit events:** `user_disabled`, `user_enabled`, `user_deleted`, `user_restored`, `user_role_changed` (details `{"from", "to"}`), `user_updated` (details `{"fields": [names only]}`; never values), `mfa_reset` (actor = admin, details `{"via": "admin"}`); existing `user_invited` gains `{"role": ...}`. Actor ids and the request IP are recorded as in earlier phases.
- **Rulings at plan time:** (1) the lifecycle changes live in `lifecycle.py`, separate from the HTTP layer, so the invariant and its race can be tested without HTTP; (2) because the super admin is untouchable and always active, the last-admin invariant cannot trigger through the API today; it is a defensive invariant, tested at the lifecycle level; (3) the list response is wrapped in `{"users": [...]}`; (4) a role change also revokes the target's sessions; (5) no database migration is needed (`deleted_at` and `status` already exist); (6) the frontend shows a non-privileged visitor of `/admin` the ordinary page.
- Phase 1-4a tests must stay green; the route-classification test (`test_mfa_guard.py`) must pass with the new routes without edits.

## Review Focus

- The policy matrix is exercised exhaustively (actor role × target role × action × self/other), and the `actions` the list returns match what the endpoints actually allow for every combination (Tasks 1 and 3).
- Disabled, deleted and demoted users lose their sessions at once and cannot sign in or reuse a cookie; password resets and re-enabling behave per the state machine (Tasks 2 and 3).
- The last-admin invariant holds under concurrency, and no path creates a second super admin or lets an admin touch an admin (Tasks 2 and 3).
- A deleted account's username and email stay reserved, restore works, and the email-edit rule (only while invited) holds (Task 3).
- Audit rows exist for every new action with the right actor and no email addresses; the admin page never renders a button the server did not list (Tasks 3 and 4).

---

### Task 1: The authority policy

**Files:**
- Create: `backend/app/auth/policy.py`
- Test: `backend/tests/test_policy.py`

**Interfaces:**
- Produces (pure functions over `app.models.User`; no database):
  - `ACTIONS: tuple[str, ...]` = `("view", "edit", "resend_invite", "reset_password", "reset_mfa", "disable", "enable", "delete", "restore", "set_role")`.
  - `authority_error(actor: User, target: User, action: str) -> ApiError | None`: applies the ordered checks above and returns `ApiError(403, "forbidden")`, `ApiError(403, "cannot_target_self")` or `None`.
  - `check(actor: User, target: User, action: str) -> None`: raises what `authority_error` returns.
  - `state_allows(target: User, action: str) -> bool`: whether the target's current state permits the action (`resend_invite` needs `invited`; `reset_password` needs `active`; `reset_mfa` needs `mfa_enabled` and status not `deleted`; `disable` needs `invited`/`active`; `enable` needs `disabled`; `delete` needs not `deleted`; `restore` needs `deleted`; `edit` and `set_role` need not `deleted`; `view` always).
  - `available_actions(actor: User, target: User) -> list[str]`: the actions, in `ACTIONS` order, for which `authority_error` is `None` and `state_allows` is true.
  - `can_invite_role(actor: User, role: str) -> bool`: `user` for admin/superadmin; `admin` for superadmin only; anything else false.

- [ ] **Step 1: Write `test_policy.py` first** (build transient `User(...)` objects with `id`, `role`, `status`, `mfa_enabled`, `password_hash`; no database):
  - a table-driven matrix over actor role (`user`, `admin`, `superadmin`) × target role (`user`, `admin`, `superadmin`) × each action × (same user, other user) asserting the exact result of `authority_error` according to the ordered rules (a plain `user` actor is always `forbidden`; self-destructive actions give `cannot_target_self`; admin on admin or on superadmin is `forbidden` except `view`; superadmin on superadmin only `view` and `reset_password` on themselves; `set_role` is `forbidden` for admins even on users).
  - `state_allows` for every action against each status and with/without TOTP.
  - `available_actions` examples: admin viewing an `active` user with TOTP → `view, edit, reset_password, reset_mfa, disable, delete`; admin viewing an `admin` → `["view"]`; superadmin viewing an `invited` admin → `view, edit, resend_invite, disable, delete, set_role`; anybody viewing a `deleted` user → `view` plus `restore` for those with authority; viewing the superadmin → `["view"]` (plus `reset_password` for the superadmin themselves).
  - `can_invite_role` for each actor role and for `superadmin` and a nonsense role.
- [ ] **Step 2: Run to watch it fail** — `cd backend && .venv/bin/pytest tests/test_policy.py -q` → FAIL (module missing).
- [ ] **Step 3: Implement** `policy.py` to the Interfaces.
- [ ] **Step 4: Run the whole suite** — `cd backend && .venv/bin/pytest -q` → all pass.
- [ ] **Step 5: Commit** `feat(admin): central authority policy`.

---

### Task 2: Lifecycle changes and the last-admin invariant

**Files:**
- Create: `backend/app/auth/lifecycle.py`
- Test: `backend/tests/test_lifecycle.py`

**Interfaces:**
- Consumes: Task 1 (`policy.state_allows`), phase 3/4a helpers (`tokens`, models).
- Produces (all take an open `Session` and a loaded `User`, change it, never commit; raise `ApiError`):
  - `revoke_sessions(db, user_id: int) -> None`; `void_tokens(db, user_id: int) -> None` (marks the user's unused tokens used).
  - `ensure_not_last_admin(db, target: User) -> None`: when `target` is an `active` `admin`/`superadmin`, locks all active privileged rows with `SELECT id FROM users WHERE role IN ('admin','superadmin') AND status = 'active' FOR UPDATE` and raises `ApiError(409, "last_admin")` if none other than `target` remains; otherwise returns.
  - `disable(db, target)`, `enable(db, target)`, `delete(db, target)`, `restore(db, target)`: the state machine above (`409 invalid_state` on a wrong source state); `disable` and `delete` call `ensure_not_last_admin` first and revoke sessions; `delete` also sets `deleted_at` and voids tokens; `restore` clears `deleted_at`.
  - `change_role(db, target, new_role: str)`: `new_role` in (`user`, `admin`); target must be `user` or `admin` and not `deleted`; same role → `409 invalid_state`; demoting an admin calls `ensure_not_last_admin`; revokes sessions.
  - `update(db, target, locale: str | None, email: str | None) -> list[str]`: applies the edit rules and returns the changed field names; email while not `invited` → `409 invalid_state`; deleted target → `409 invalid_state`; sets `updated_at`.
  - `reset_mfa(db, target)`: `409 not_enabled` unless `mfa_enabled`; clears `mfa_secret`, `mfa_enabled`, `mfa_last_step`, deletes recovery codes, revokes sessions.

- [ ] **Step 1: Write `test_lifecycle.py` first** (database via `owner_engine`/`app_engine`, `add_user`, `add_mfa_user`):
  - every allowed transition and every refused one for `disable`, `enable`, `delete`, `restore` (including `enable` of a passwordless disabled user → `invited`, of one with a password → `active`; `restore` → `disabled` with `deleted_at` cleared; `delete` sets `deleted_at` and marks outstanding tokens used);
  - sessions: after `disable`, `delete`, `change_role` and `reset_mfa` the target's sessions have `revoked_at` set and other users' sessions do not;
  - `change_role`: user→admin and admin→user work; same role, superadmin target, deleted target, and bad role are refused;
  - `update`: locale change; email change only while `invited` (lowercased); email for an `active` user refused; returns the changed field names;
  - `reset_mfa`: clears everything for a TOTP user, `409 not_enabled` otherwise;
  - `ensure_not_last_admin`: with a single active admin it raises `last_admin` for `disable`, `delete` and demotion; with two active admins both succeed individually; non-privileged and non-active targets are never blocked;
  - **concurrency:** two active admins and no other privileged user; two threads, each with its own `Session` and a barrier, each demote (or disable) a different admin in one transaction and commit; exactly one succeeds and the other raises `last_admin`, and one active admin remains.
- [ ] **Step 2: Run to watch it fail** — `cd backend && .venv/bin/pytest tests/test_lifecycle.py -q` → FAIL.
- [ ] **Step 3: Implement** `lifecycle.py` to the Interfaces.
- [ ] **Step 4: Run the whole suite** → all pass.
- [ ] **Step 5: Commit** `feat(admin): user lifecycle changes and the last-admin invariant`.

---

### Task 3: Admin endpoints

**Files:**
- Modify: `backend/app/auth/admin.py`
- Test: `backend/tests/test_admin_lifecycle.py` (new), `backend/tests/test_admin.py` (must keep passing; adjust only where the new authority rules change an old expectation, and say so in the ledger)

**Interfaces:**
- Consumes: Tasks 1-2, phase 3 `admin.py` helpers (`create_user`, `queue_email`, `tokens`), `audit`.
- Produces (router `/api/admin`, admin role check on every route; mutating routes need Origin and CSRF; unknown id `404 not_found`; every action first calls `policy.check` (then lifecycle, audit, commit)):
  - `GET /users` → `{"users": [...]}` as specified; `actions` from `policy.available_actions(actor, row)`.
  - `POST /users`: body gains optional `role` (`"user"` default, `"admin"`); `policy.can_invite_role` false → `403 forbidden`; `user_invited` audit details include `role`; the created account has that role.
  - `PATCH /users/{id}` `{locale?, email?}` → `200 {"user": <payload>}` (action `edit`); audit `user_updated` with `{"fields": [...]}`.
  - `POST /users/{id}/disable`, `/enable`, `/delete`, `/restore` → `200 {"status": "ok"}` (audit `user_disabled`, `user_enabled`, `user_deleted`, `user_restored`).
  - `POST /users/{id}/role` `{role: "user"|"admin"}` → `200 {"user": <payload>}` (action `set_role`; audit `user_role_changed` `{from, to}`).
  - `POST /users/{id}/reset-mfa` → `200 {"status": "ok"}` (action `reset_mfa`; audit `mfa_reset`, `details {"via": "admin"}`, actor = the admin).
  - Existing `POST /users/{id}/invite` (action `resend_invite`) and `/reset` (action `reset_password`) now also go through `policy.check`; their old behavior and error codes stay.

- [ ] **Step 1: Write `test_admin_lifecycle.py` first** (helpers from phase 3/4a; actors log in without TOTP, state `ok`):
  - `test_list`: shape and sorting; `last_sign_in` is null for a user who never signed in and an ISO timestamp after sign-in; `mfa_enabled`; deleted accounts included; plain `user` → `403`, anonymous → `401`, a `verify`-state session → `403 mfa_required`.
  - `test_actions_match_endpoints` (table-driven, keep runtime under about 60 s): for each scenario (actor role `admin`/`superadmin` × target role `user`/`admin`/`superadmin` × target status `invited`/`active`/`disabled`/`deleted` × target with/without TOTP), rebuild the database state, read the row's `actions`, call every action not listed (excluding `view`) and require a refusal (`403` or `409`, never `2xx`) with the database unchanged, then for each listed action rebuild the scenario, call it (payloads: `set_role` → the opposite role, `edit` → `{"locale": "en"}`, others empty) and require `2xx`.
  - `test_admin_cannot_touch_admins_or_superadmin`: an admin gets `403 forbidden` for every action on an admin and on the superadmin; the superadmin can act on admins; nobody can set role `superadmin`; an admin inviting `role: "admin"` is `403`, the superadmin inviting an admin works (new account has role `admin`, status `invited`).
  - `test_no_self_destruction`: each of disable, delete, role, reset-mfa on oneself → `403 cannot_target_self`; reset-password on oneself works.
  - `test_disable_and_enable`: a disabled user's open session returns `401` on `/me` immediately and sign-in gives the generic `401`; after `enable` they can sign in again (a passwordless invited-then-disabled user returns to `invited`).
  - `test_delete_and_restore`: delete revokes sessions and voids invite/reset links; the username and email stay reserved (creating the same username or email → `409 already_exists`); `restore` → `disabled`, then `enable` → `active`.
  - `test_role_change`: superadmin promotes a user to admin (they then pass the admin gate) and demotes back; their sessions are revoked each time; an admin gets `403`.
  - `test_reset_mfa`: clears TOTP and recovery codes, revokes the target's sessions, audit `mfa_reset` has the admin as actor and `via: admin`; refused for the superadmin target and for self; `409 not_enabled` otherwise.
  - `test_edit_rules`: locale change for an `active` user; email change for an `invited` user (lowercased) → `200`; email for an `active` user → `409 invalid_state`; duplicate email → `409 already_exists`; empty body → `422`; audit `user_updated` lists field names and contains no email address.
  - `test_audit_events`: each new action writes its audit row with the admin as actor and the target id; `user_role_changed` has `from`/`to`; no row contains an email address.
  - `test_last_admin_is_defensive`: a request that would remove the last active privileged user is `409 last_admin` (set up in the database by disabling other privileged rows directly).
- [ ] **Step 2: Run to watch them fail** — `cd backend && .venv/bin/pytest tests/test_admin_lifecycle.py -q` → FAIL.
- [ ] **Step 3: Implement** the endpoints; keep handlers thin (policy → lifecycle → audit → commit); `GET /users` builds `last_sign_in` with one grouped query on `sessions`.
- [ ] **Step 4: Run the whole suite** — all pass, including `test_admin.py`, `test_mfa_guard.py` (the new routes are covered automatically) and every earlier test.
- [ ] **Step 5: Commit** `feat(admin): user list and lifecycle endpoints`.

---

### Task 4: Admin page

**Files:**
- Create: `frontend/src/AdminPage.tsx`, `frontend/src/AdminInvite.tsx`, `frontend/src/AdminUserRow.tsx`
- Modify: `frontend/src/api.ts`, `frontend/src/App.tsx`, `frontend/src/SignedIn.tsx`, `frontend/src/locales/{fr-CA,en,pt-BR}.json`, `frontend/src/index.css`
- Test: `frontend/src/Admin.test.tsx` (new)

**Interfaces:**
- Consumes: Task 3 endpoints; phase 2-4a `api.ts`, `Session`, `route.ts`.
- Produces:
  - `api.ts`: `type AdminUser = {id: number; username: string; email: string; role: "user"|"admin"|"superadmin"; locale: "fr-CA"|"en"|"pt-BR"; status: "invited"|"active"|"disabled"|"deleted"; mfaEnabled: boolean; createdAt: string; lastSignIn: string | null; actions: string[]}`; `adminList(): Promise<AdminUser[] | null>`; `adminInvite(csrf, {username, email, locale, role}): Promise<{ok: true} | {ok: false; reason: AdminError}>`; `adminAct(csrf, id, action: "invite"|"reset"|"disable"|"enable"|"delete"|"restore"|"reset-mfa"): Promise<AdminResult>`; `adminSetRole(csrf, id, role)`; `adminEdit(csrf, id, {locale?, email?})`; where `AdminError = "forbidden"|"self"|"invalid_state"|"last_admin"|"exists"|"network"` and `AdminResult = {ok: true} | {ok: false; reason: AdminError}` (maps `403 forbidden`, `403 cannot_target_self`, `409 invalid_state`/`not_active`/`not_enabled`/`not_invited`, `409 last_admin`, `409 already_exists`; anything else `network`). All send `X-CSRF-Token` and JSON.
  - `App`: path `/admin`: anonymous → the login form (after sign-in the page stays at `/admin`); signed in with state `ok` and role `admin`/`superadmin` → `AdminPage`; any other signed-in visitor sees the ordinary page. `SignedIn` shows a link (`adminOpen`) to `/admin` for those two roles.
  - `AdminPage`: loads the list; search box filtering by username or email (case-insensitive); "show deleted" toggle (deleted rows hidden by default); the invite form (`AdminInvite`: username, email, language, and a role select only for a signed-in `superadmin`); rows (`AdminUserRow`) as a table on wide screens and cards on phones (one markup, CSS decides); badges for role, status and two-step state (an `admin`/`superadmin` row without two-step shows the `adminAdminNoMfa` flag); last sign-in or `adminNever`; buttons only for the actions in the row's `actions` (`act_<action>` labels; for `set_role` the label is `act_make_admin` for a `user` row and `act_make_user` for an `admin` row; `view` renders nothing); `disable`, `delete`, `set_role`, `reset_mfa` and `reset_password` use an inline two-step confirmation (click shows `confirm` and `adminCancel`, no browser dialogs); `edit` opens an inline form (language select, and an email field only for `invited` rows) with `adminSave`/`adminCancel`; after any success the list reloads and `adminDone` is shown; failures show `errForbidden`, `errSelf`, `errInvalidState`, `errLastAdmin`, `errExists` or `networkError`.
  - Locale keys, identical in all three files: `adminTitle`, `adminOpen`, `adminBack`, `adminSearch`, `adminShowDeleted`, `adminInviteTitle`, `adminInviteSend`, `adminInviteSent`, `adminUsername`, `adminEmail`, `adminLanguage`, `adminRole`, `adminNever`, `adminLastSignIn`, `adminMfaOn`, `adminMfaOff`, `adminAdminNoMfa`, `status_invited`, `status_active`, `status_disabled`, `status_deleted`, `act_edit`, `act_resend_invite`, `act_reset_password`, `act_reset_mfa`, `act_disable`, `act_enable`, `act_delete`, `act_restore`, `act_make_admin`, `act_make_user`, `adminSave`, `adminCancel`, `adminDone`, `errForbidden`, `errSelf`, `errInvalidState`, `errLastAdmin`, `errExists`. (Existing keys such as `confirm`, `role_user`, `role_admin`, `role_superadmin`, `networkError` are reused.)

- [ ] **Step 1: Write `Admin.test.tsx` first** (mock `fetch` as in earlier tests; sessions come from a mocked `GET /api/auth/me`):
  - an admin sees the link on the signed-in page and `/admin` shows the list; a plain `user` visiting `/admin` sees the ordinary page; an anonymous visitor sees the login form.
  - the list renders rows with role, status, two-step badge and last sign-in (and `adminNever`); the search box filters; deleted rows appear only after the toggle; an admin row without two-step shows `adminAdminNoMfa`.
  - buttons appear exactly for each row's `actions` (a row with `actions: ["view"]` has none; a `user` row with `set_role` shows `act_make_admin`).
  - confirmation: clicking `act_disable` sends no request until `confirm` is clicked, then posts `/api/admin/users/<id>/disable` with the CSRF header and reloads the list and shows `adminDone`; `adminCancel` sends nothing.
  - the invite form posts `{username, email, locale, role}` (role select only for a super admin; an admin's request has `role: "user"`), shows `adminInviteSent`, and reloads; a `409` shows `errExists`.
  - failures: a `403` shows `errForbidden`, `403 cannot_target_self` shows `errSelf`, `409 invalid_state` shows `errInvalidState`, `409 last_admin` shows `errLastAdmin`, a rejected fetch shows `networkError`.
  - edit: the inline form sends `PATCH` with `{locale}` (and `{email}` only for an invited row).
  - locale key parity for the new keys (extend or reuse the existing parity test).
- [ ] **Step 2: Run to watch them fail** — `cd frontend && npx vitest run` → new tests FAIL.
- [ ] **Step 3: Implement** the files above in the KMK look, usable at phone width and in dark mode.
- [ ] **Step 4: Run tests and build** — `cd frontend && npx vitest run && npm run build` → all pass; `npm audit --omit=dev` reports nothing new.
- [ ] **Step 5: Commit** `feat(frontend): admin page`.

---

### Task 5: Documentation

**Files:**
- Modify: `docs/README.md`, `docs/security.md`, `docs/roadmap.md`, `docs/operations.md` (only if something operational changed), `README.md` and `CLAUDE.md` (counts and pointers only)

**Interfaces:**
- Consumes: the finished code and the running system.
- Produces: documentation that matches the system after phase 4b.

- [ ] **Step 1: Gather facts** from the code: `app.openapi()` route list, `policy.py` rules, `lifecycle.py` state machine, new audit events, test counts (`pytest -q`, `vitest run`).
- [ ] **Step 2: Update the documents:** `docs/README.md` (status table: 4b done, link the spec and plan; API table gains every new route with who may call it and the page `/admin`; the `users` description gains the `invited`/`deleted` lifecycle); `docs/security.md` (the authority matrix as implemented, the state machine, session effects of each action, the last-admin invariant and why it is defensive, the new audit events, and a note that the rule "only the super admin manages admins" overrides `scope.md` §6); `docs/roadmap.md` (4b done and removed from "next", record the override, update "next" to phase 5 and 6, and add any deferred minors that arose, such as no audit viewer and no pagination); `README.md` and `CLAUDE.md` (updated test counts; mention `policy.py` as the place for authority rules and that new admin actions must go through it).
- [ ] **Step 3: Verify the documents against the system:** every route, command, event name and count mentioned exists or matches (grep the code, print the route list, run the tests); all links resolve; no secrets.
- [ ] **Step 4: Commit** `docs: phase 4b`.

---

### Task 6: Deploy and verify live

**Files:** none new (rebuild only).

**Interfaces:**
- Consumes: everything above.
- Produces: the admin page live; a handoff for the user.

- [ ] **Step 1: Deploy:** `cd frontend && npm run build`; `cd deploy && docker compose up -d --build`. Expected: `kmk-api` starts, revision stays `0004`, no errors in `docker logs kmk-api`.
- [ ] **Step 2: Verify through Caddy** (do not touch real accounts):

```bash
H='Host: app.kmk-entretien.ca'; B=http://127.0.0.1:8081; O='Origin: https://app.kmk-entretien.ca'; J='Content-Type: application/json'
curl -s -H "$H" $B/api/health                                                         # {"status":"ok"}
curl -s -o /dev/null -w 'list %{http_code}\n' -H "$H" $B/api/admin/users              # 401 (anonymous)
for a in disable enable delete restore role reset-mfa; do
  curl -s -o /dev/null -w "$a %{http_code}\n" -H "$H" -H "$O" -H "$J" -d '{}' $B/api/admin/users/1/$a; done   # 401 each
curl -s -o /dev/null -w 'patch %{http_code}\n' -X PATCH -H "$H" -H "$O" -H "$J" -d '{}' $B/api/admin/users/1   # 401
docker exec postgres psql -U postgres -d kmk -Atc "select version_num from alembic_version"   # 0004
docker exec postgres psql -U postgres -d kmk -Atc "select role, status from users"            # unchanged
docker exec kmk-api id -u                                                              # not 0
docker ps --format '{{.Names}}' | grep -E 'famillai|^postgres$'                        # all running
curl -s -o /dev/null -w 'spa %{http_code}\n' https://app.kmk-entretien.ca/admin        # 200 (SPA deep link)
```

- [ ] **Step 3: Hand off to the user** (their browser; no passwords through the assistant): open `https://app.kmk-entretien.ca/admin` after signing in as the super admin; check the list and badges; invite a throwaway test account with a real inbox only if Resend is set up (otherwise read the link from `docker logs kmk-api`), then try disable, enable, delete and restore on that test account, and check the page on a phone and in dark mode. Recommend turning on `MFA_REQUIRED_ROLES=admin,superadmin` before inviting any admins (see `docs/operations.md`).
- [ ] **Step 4: Commit** only if the tracked files changed (for example the docs); otherwise nothing to commit.
