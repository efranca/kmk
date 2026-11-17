# kmk User Name Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every person has one `name` ("Marie Tremblay"): required on invitation, editable by admins (plain users) and by the super admin (everyone, including themselves), shown wherever a person is identified (greeting, account page, admin list with name search and sort, emails, CLI), with the username as fallback and sign-in handle.

**Architecture:** One nullable column `users.name` (migration `0005`); a small `app/names.py` for validation and accent-insensitive folding; the name flows through `user_payload`, the admin list, invite and edit endpoints, the email greeting, two CLI commands and the React screens. One authority change: the super admin may edit their own account.

**Tech Stack:** as earlier phases; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-17-user-name-design.md` (also `docs/README.md`, `docs/decisions.md`, the phase 4b admin design)

## Global Constraints

- All earlier Global Constraints hold (tests first and watched failing, every protected route behind the guard, the authority policy decides who may do what, tests only on `kmk_test`, strings in all three locale files with the parity test, secrets never printed, commit trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`).
- **Name rules** (one function, `app.names.clean_name(value: str) -> str`, raises `ValueError`): Unicode-normalize to NFC; trim; collapse runs of space separators into one space; reject any control or format character (Unicode categories `Cc`, `Cf`, `Cs`, `Co`, `Cn`: this includes line breaks, zero-width and direction-override characters); allow only letters (`L*`), combining marks (`M*`), digits (`N*`), the space, apostrophes (`'` and `’`), hyphen `-` and period `.`; length 1 to 100 after cleaning. Markup characters such as `< > & " / @` are therefore refused.
- **Database:** `users.name text NULL` with `CONSTRAINT users_name_valid CHECK (name IS NULL OR char_length(btrim(name)) BETWEEN 1 AND 100)`. No new grants (`kmk_app` already has DML on `users`). Existing rows keep `NULL`.
- **Display rule everywhere:** show the name when present, otherwise the username. Where two people could share a name the username is shown next to it. Names are not unique.
- **Authority:** one change in `policy.py`: `edit` on oneself is allowed for the super admin (name and language; the email can only change while invited, so it does not apply). Everything else is unchanged: the self rules still forbid disable, delete, role change and two-step reset on oneself; an admin may edit plain users only; a plain user edits nobody. The super admin may edit the name of anyone.
- **Privacy:** a name never appears in an audit row, log line or error message. A name edit is audited as `user_updated` with `{"fields": [..., "name"]}` (field names only). Names are returned only to the person themselves (`/me`, login) and to admins (`GET /api/admin/users`, admin responses).
- **API shapes:** the user payload gains `"name": <string or null>`; each row of `GET /api/admin/users` gains `name`; `POST /api/admin/users` requires `name`; `PATCH /api/admin/users/{id}` accepts `name` (at least one of `locale`, `email`, `name` is required); an invalid name is a `422`.
- **Sorting:** the admin list is sorted in Python by `names.sort_key`: the folded name (accents removed, case folded) or, when there is none, the folded username; ties by username.
- **Rulings at plan time:** (1) the new module is `backend/app/names.py`; (2) existing tests that post invitations get a `name` (a deliberate behavior change: it is now required), and the policy matrix test and `available_actions` examples are updated for the super admin's self-edit; (3) sorting is done in Python (the list is small) rather than with a database collation; (4) `create-superadmin` requires `--name` even though the column is nullable (existing rows predate it); (5) the email greeting uses the whole name; (6) frontend article labels use the display name, so tests that find rows by username keep working for accounts without a name.
- The earlier suites stay green apart from the deliberate test updates in ruling (2): 310 backend and 83 frontend tests before this change.

## Review Focus

- Authority: the super admin can edit their own name and anyone's; an admin still cannot edit an admin or the super admin; a plain user edits nobody; the table-driven policy test and the "listed actions match what the endpoints allow" test both pass (Task 1).
- Name validation resists abuse: control and direction characters, markup characters, line breaks, enormous or empty values are refused by the API, and the database constraint is a second line of defense (Task 1).
- Names never reach audit details, logs or error messages; emails escape the name, never put it in a header or subject, and fall back cleanly without a name (Tasks 1, 2, 3).
- Every screen and email works for an account without a name (the existing super admin) and for a name with accents, apostrophes or hyphens (Tasks 2, 4).
- The documentation and the runbook queries match the system (Task 5).

---

### Task 1: Schema, validation, API and authority

**Files:**
- Create: `backend/alembic/versions/0005_user_name.py`, `backend/app/names.py`
- Modify: `backend/app/models.py`, `backend/app/auth/service.py` (`user_payload`), `backend/app/auth/admin.py`, `backend/app/auth/lifecycle.py`, `backend/app/auth/policy.py`
- Test: `backend/tests/test_names.py` (new), extend `test_schema_permissions.py`, `test_policy.py`, `test_lifecycle.py`, `test_admin.py`, `test_admin_lifecycle.py`, `test_auth.py`; update invitation posts in `test_admin.py`, `test_admin_lifecycle.py`

**Interfaces:**
- Produces:
  - Migration `0005` and `User.name: Mapped[str | None]`.
  - `app.names.clean_name(value: str) -> str` (rules above; raises `ValueError`); `app.names.fold(text: str) -> str` (NFKD, combining marks removed, case folded, whitespace collapsed); `app.names.sort_key(name: str | None, username: str) -> tuple[str, str]`.
  - `service.user_payload(user)` includes `"name"`.
  - `admin.NewUser.name: str` (required, validated with `clean_name`); `admin.EditUser.name: str | None`; `EditUser` still needs at least one of the three fields.
  - `lifecycle.update(db, target, locale: str | None, email: str | None, name: str | None = None) -> list[str]`: changed field names may include `"name"`; refused for deleted accounts (`409 invalid_state`); a name equal to the current one is not a change.
  - `GET /api/admin/users`: each row has `name`; rows sorted by `names.sort_key`.
  - `PATCH /api/admin/users/{id}` accepts `name`; audit `user_updated` lists `name` among the field names, never the value.
  - `policy.authority_error`: `edit` on oneself is allowed for the super admin.

- [ ] **Step 1: Write the tests first**
  - `test_names.py`: `clean_name` accepts `"Marie Tremblay"`, `"Élise-Anne O'Brien"`, `"Jean-François de la Fontaine"`, `"李 明"`, `"Zoë D’Amour"`, and returns it NFC-normalized; collapses `"  Marie   Tremblay "` to `"Marie Tremblay"`; refuses `""`, `"   "`, 101 characters, a name with `\n`, `\t`, a zero-width space, a right-to-left override, `<b>x</b>`, `a@b`, `"quote"`, `a/b`; accepts exactly 100 characters. `fold("Élise")` equals `fold("elise")` and `fold("ÉLISE")`; `sort_key(None, "bob")` uses the username; sorting `[("Émile","e"),("Zoé","z"),("anne","a"),(None,"bea")]` gives anne, bea, Émile, Zoé.
  - `test_schema_permissions.py`: `kmk_app` can set and read `name`; a blank (`'   '`) or 101-character name is rejected by the check constraint; `NULL` is allowed.
  - `test_policy.py`: update the hand-written matrix so `edit` on oneself is allowed for the super admin only (an admin editing themselves, and an admin editing an admin or the super admin, stay forbidden); `available_actions(root, root) == ["view", "edit", "reset_password"]`.
  - `test_lifecycle.py`: `update(db, target, None, None, "Marie Tremblay")` returns `["name"]` and stores it; the same name again returns `[]`; `update` with locale and name returns both field names; a deleted account is `409 invalid_state`.
  - `test_admin.py` / `test_admin_lifecycle.py`: update every existing invitation post to include a valid `name`; new tests: inviting without a name, with a blank name, with 101 characters, with markup, with a line break each return `422` and create nothing; a valid name is stored cleaned (`"  Marie   Tremblay "` stored as `"Marie Tremblay"`) and appears in the response and in `GET /api/admin/users`; the list is sorted with accents and capitals ignored and accounts without a name sorted by username; `PATCH` with `{"name": ...}` works for an admin on a plain user and for the super admin on a plain user, on an admin **and on themselves**, and returns the new name; an admin editing an admin or the super admin gets `403`, and a plain user `403`; an invalid name on `PATCH` is `422`; an empty body is `422`; the audit row for a name edit contains `"name"` as a field name and **no name text** (assert the new name string appears in no audit row and no captured log line); the existing `test_listed_actions_match_what_the_endpoints_allow` passes with the self-edit exception (the `superadmin` + `self` scenario now lists `edit` and the endpoint accepts it).
  - `test_auth.py`: `/me` and the login response contain `name` (null for an account without one, the name for one with it).
- [ ] **Step 2: Run to watch them fail** — `cd backend && .venv/bin/pytest -q` → new tests FAIL/ERROR (and the updated expectations for the policy and posts).
- [ ] **Step 3: Implement** the migration, model, `names.py`, payload, admin endpoints, lifecycle and the policy exception to the Interfaces.
- [ ] **Step 4: Run the whole suite** — `cd backend && .venv/bin/pytest -q` → all pass.
- [ ] **Step 5: Commit** `feat(users): a name for every person (schema, validation, API, authority)`.

---

### Task 2: Emails greet by name

**Files:**
- Modify: `backend/app/emails/templates.py`, `backend/app/auth/account.py` (`queue_email`), `backend/app/auth/admin.py` if it builds messages directly
- Test: `backend/tests/test_emails.py` (extend), `backend/tests/test_account.py`, `backend/tests/test_admin.py` (extend)

**Interfaces:**
- Consumes: Task 1 (`User.name`).
- Produces: `templates.render(kind, locale, link, to, name: str | None = None) -> EmailMessage`: with a name the first line of the text (and the first paragraph of the HTML) is `Bonjour {name},` / `Hello {name},` / `Olá {name},`; without a name it is the current `Bonjour,` / `Hello,` / `Olá,`. The name is HTML-escaped in the HTML part and appears only in the body, never in the subject or any header. `account.queue_email` passes `user.name`.

- [ ] **Step 1: Write the tests first:** every (kind × locale) renders the personalized greeting with a name and the old wording without one; a name such as `"Zoë D’Amour"` appears exactly in both parts; a name containing markup is impossible through the API (Task 1), but `render` itself must still escape: `render(..., name="<b>x</b>")` yields `&lt;b&gt;x&lt;/b&gt;` in the HTML and the subject is identical with and without a name; the invite email created through the admin endpoint for a person named `"Marie Tremblay"` greets `Marie Tremblay`; a forgot-password email for an account without a name keeps the generic greeting; a log-only email (`log` backend) does not print anything beyond the message itself.
- [ ] **Step 2: Run to watch them fail** — `cd backend && .venv/bin/pytest tests/test_emails.py tests/test_account.py tests/test_admin.py -q`.
- [ ] **Step 3: Implement** the greeting (refactor the intro strings so the greeting is separate from the body text).
- [ ] **Step 4: Run the whole suite** → all pass.
- [ ] **Step 5: Commit** `feat(emails): greet people by name`.

---

### Task 3: Command-line tools

**Files:**
- Modify: `backend/app/cli.py`
- Test: `backend/tests/test_cli.py` (extend)

**Interfaces:**
- Consumes: Task 1 (`names.clean_name`, `lifecycle.update` or direct update, `audit.log`).
- Produces: `create-superadmin --username U --email E --name N [--locale L]` (`--name` required; validated with `clean_name`; an invalid name exits `1` without creating anything); `set-name --username U --name N` (`main` returns `0` on success, `1` for an unknown user or an invalid name; audit `user_updated` with details `{"fields": ["name"], "via": "cli"}`, actor null, **no name value**); output never prints the name back in an error line beyond what the user typed.

- [ ] **Step 1: Write the tests first:** the existing `create-superadmin` tests pass `--name` and the stored name is cleaned; a missing `--name` is a usage error (exit `2`); an invalid name (blank, markup) exits `1` and creates nothing; `set-name` sets and changes the name of an existing user (including the super admin), exits `1` for an unknown username and for an invalid name, and the audit row has `fields: ["name"]`, `via: "cli"`, actor null, and does not contain the name; the password prompt behavior of `create-superadmin` is unchanged.
- [ ] **Step 2: Run to watch them fail** — `cd backend && .venv/bin/pytest tests/test_cli.py -q`.
- [ ] **Step 3: Implement** the options and the subcommand.
- [ ] **Step 4: Run the whole suite** → all pass.
- [ ] **Step 5: Commit** `feat(cli): name for create-superadmin and a set-name command`.

---

### Task 4: Frontend

**Files:**
- Create: `frontend/src/person.ts`
- Modify: `frontend/src/api.ts`, `frontend/src/AdminInvite.tsx`, `frontend/src/AdminUserRow.tsx`, `frontend/src/AdminPage.tsx`, `frontend/src/WelcomePage.tsx`, `frontend/src/AccountPage.tsx`, `frontend/src/locales/{fr-CA,en,pt-BR}.json`, `frontend/src/index.css`
- Test: `frontend/src/Admin.test.tsx` (extend and update invitation expectations), `frontend/src/Shell.test.tsx` (greeting), new `frontend/src/Name.test.tsx`

**Interfaces:**
- Consumes: Task 1 payloads.
- Produces:
  - `api.ts`: `User.name: string | null` and `AdminUser.name: string | null` (mapped from `name`, default `null`); `adminInvite(csrf, {name, username, email, locale, role})`; `adminEdit(csrf, id, {locale?, email?, name?})`; `AdminError` gains `"invalid"` mapped from `422`.
  - `person.ts`: `displayName(p: {name: string | null; username: string}): string`; `fold(text: string): string` (NFD, strip combining marks, lower case) for accent- and case-insensitive search.
  - Screens: the Welcome page greets `t("welcome", {name: displayName(user)})`; the Account page shows `{name} · {username}` (just the username without a name); the admin list shows the display name in bold with `username · email` underneath and uses the display name as the article label; the search filter matches the folded name, username and email; the invite form gets a required "Name" field (`autoComplete="name"`, `maxLength` 100) and sends it; the inline edit form gets a name field (prefilled with the current name) and sends only changed fields; a `422` shows `errInvalidInput`.
  - Locale keys (identical in all three files): `adminName` ("Nom complet" / "Full name" / "Nome completo") and `errInvalidInput` ("Vérifiez les champs : le nom doit compter de 1 à 100 caractères, sans symboles spéciaux." / "Check the fields: the name must be 1 to 100 characters, without special symbols." / "Verifique os campos: o nome deve ter de 1 a 100 caracteres, sem símbolos especiais.").

- [ ] **Step 1: Write the tests first** (mock `fetch` as in earlier frontend tests):
  - greeting and account page: with a name the heading is `Bonjour, Marie Tremblay` and the account page shows `Marie Tremblay · alice`; without a name both fall back to `alice`.
  - admin list: a row with a name shows the name prominently and `username` and email beneath and is found by `getByRole("article", {name: "Marie Tremblay"})`; a row without a name keeps the old display and label; searching `elise` finds `Élise Gagnon`, `ÉLISE` too, `gagnon` too; searching by username and by email still works.
  - invite: the Name field is required (the form has the `required` attribute), the request body is exactly `{name, username, email, locale, role}`; a `422` response shows `errInvalidInput`; the existing invitation tests are updated to fill the name and expect it in the body.
  - edit: opening the inline form shows the current name; changing only the name sends `{"name": ...}`; the super admin's own row offers the edit action (from the row's `actions`) and sending it works; a row whose `actions` lacks `edit` shows no edit button (existing behavior).
  - `person.ts` unit tests for `displayName` and `fold`.
  - locale key parity for the two new keys.
- [ ] **Step 2: Run to watch them fail** — `cd frontend && npx vitest run` → new and updated tests FAIL.
- [ ] **Step 3: Implement** the files above in the KMK look (existing tokens, phone-friendly: the name may wrap, the username line is muted).
- [ ] **Step 4: Run tests and build** — `cd frontend && npx vitest run && npm run build && npm audit --omit=dev` → all pass, nothing new reported.
- [ ] **Step 5: Commit** `feat(frontend): show and edit people by name`.

---

### Task 5: Documentation

**Files:**
- Modify: `docs/README.md`, `docs/security.md`, `docs/golive.md`, `docs/operations.md`, `docs/decisions.md`, `docs/roadmap.md` (if anything changes there), `README.md`

**Interfaces:**
- Consumes: the finished code and the running system.
- Produces: documentation that matches the system after this change.

- [ ] **Step 1: Gather facts:** the final payload shapes (`app.openapi()`), the CLI help for both commands, the policy table, test counts, and run each updated `psql` query.
- [ ] **Step 2: Update the documents:** `docs/README.md` (data model: the `name` column; the admin API rows mention `name`; the pages description: names shown); `docs/security.md` (the authority table: the super admin may edit their own account; a new short paragraph "Names are personal information": who can see them, never in audit details or logs, in the encrypted backups, soft deletion keeps them, no erasure feature yet); `docs/golive.md` (the invitation steps include the name; the audit queries that show a person now also select `u.name` (or join `users`) so the name appears next to the username: **run every changed query against the live database to confirm it works**); `docs/operations.md` (`create-superadmin --name` and `set-name`, with examples); `docs/decisions.md` (a new entry: one name field, who may edit it, the super admin's self-edit exception, privacy handling); `README.md` (test counts).
- [ ] **Step 3: Verify the documents against the system:** every command and option exists (`--help`), links and anchors resolve, the queries run, no secrets.
- [ ] **Step 4: Commit** `docs: a name for every person`.

---

### Task 6: Deploy and verify live

**Files:** none new (rebuild only).

**Interfaces:**
- Consumes: everything above.
- Produces: the live feature; the owner's own name set.

- [ ] **Step 1: Deploy:** `cd frontend && npm run build`; `cd deploy && docker compose up -d --build`; watch both containers become healthy (use a condition loop, not a fixed sleep). Expected: the `migrate` container exits `0` applying `0005`; `select version_num from alembic_version` is `0005`; no errors in `docker logs kmk-api`.
- [ ] **Step 2: Verify through Caddy** (anonymous checks only; do not touch real accounts): the new and changed admin routes answer `401` to anonymous callers; `GET /api/health` is ok; `docker exec postgres psql ... "select count(*) from users where name is null"` shows the existing super admin still has no name; the SPA loads.
- [ ] **Step 3: Hand off to the owner:** ask for the name they want shown for the super admin account (a name is not a secret); the owner can set it themselves on the admin page (their own row now has "Modifier") or the assistant can run `cd deploy && docker compose exec api python -m app.cli set-name --username <their username> --name "<their name>"` on request; then check the greeting and the admin list in the browser, and invite a throwaway test account to see the name in the invitation email (read the link from `docker logs kmk-api 2>&1 | grep -A8 'DEV EMAIL' | tail -12` while email is in `log` mode).
- [ ] **Step 4: Commit** only if tracked files changed; otherwise nothing to commit.
