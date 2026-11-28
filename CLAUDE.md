# CLAUDE.md

Guidance for coding sessions (human or AI) in this repository. Read `docs/README.md` first for the architecture and status.

## What this is

The internal app behind https://app.kmk-entretien.ca (FastAPI backend, React frontend, shared Postgres, Caddy, Cloudflare Tunnel).
The product plan is `scope.md`; what is actually built is described in `docs/`.

## Layout

- `backend/app/` application code. `auth/` holds routes, the guard, services, rate limiting, audit, tokens, MFA. `emails/` is the mail layer. `mfa.py` and `security.py` are pure helpers. `cli.py` is the server-side admin tool.
- `backend/app/schedule/` the shared calendar: `recurrence.py` (repeat rule, `rrule`), `occurrences.py` (expansion with one-off changes), `service.py`, `routes.py`; `ics.py` (iCalendar writer) and `feed.py` (the personal `.ics` link: account routes and the public token route).
- `backend/alembic/versions/` migrations (`0001` to `0025`). `backend/tests/` is the test suite.
- `backend/app/quotes/` quote requests: `public_routes.py` + `intake.py` (the open form's API), `arrival.py` (task, Agenda item, notice, push), `service.py` + `routes.py` (the admins' area), `emails.py`. `backend/app/push/` Web Push. `backend/app/system_settings.py` the company-wide settings (super admin).
- `backend/app/clients/` the clients (`schemas.py`, `service.py`, `routes.py`); tasks, events, documents and quotes carry an optional `client_id`.
- `backend/app/invoices/` invoices: `money.py` (amounts), `billing.py` (which cleanings can be billed), `pdf.py` + `assets/` (the French PDF, logo and fonts), `service.py` (numbering, create, pay, cancel, send), `emails.py`, `schemas.py`, `routes.py`. The price per visit is `properties.visit_price`; the PDF is stored as an admins-only Document linked to the client.
- `backend/app/visits/` visit check-in and check-out: `service.py` (visibility, check-in, check-out, payloads, today), `photos.py` (photo upload and checks, removal, room skips), `storage.py` (the photo files on disk, `<id[:2]>/<id>`, files 640 and new folders 750; never a chmod of a folder), `corrections.py` (corrections after the fact, the window), `report.py` (Visits done and the CSV), `purge.py` (6-month purge and orphan sweep, run by `python -m app.cli purge-visit-photos`), `limits.py`, `schemas.py`, `routes.py` (static report routes before the `/{event_id}/{occurrence_date}` ones). Rooms and `photos_required` live on properties (`clients/`). `visit_corrections` is append-only for `kmk_app`, which also has no DELETE on `visits`, `visit_people`, `visit_photos` and `visit_room_skips` (0025). An Agenda item with visits cannot be deleted (`409 event_has_visits`); a photo removed by a correction keeps its file until the purge.
- `backend/app/tasks/` the task list and its categories: `schemas.py`, `service.py`, `routes.py`.
- `backend/app/documents/` the company library: `visibility.py` (who sees what, applied in SQL), `limits.py`, `files.py` (type by bytes), `uploads.py` (capped read, upload slots), `service.py`, `routes.py`. `backend/app/auth/devices.py` and `geo.py` are connected devices.
- `frontend/src/` React app: `App.tsx` routes by path to the card pages (sign-in, recovery, two-step screens) or to the signed-in `Shell.tsx` / `app/Layout.tsx` (Dashboard, Schedule, Account, Admin pages); `schedule/` (views, event dialog, drag, reminders), `dashboard/` (the five widgets: My events, All events, My tasks, and for admins Quotes summary and Latest quotes), `tasks/` (the task list, dialog, categories) and `ui/` (shared pieces) hold the calendar; `visits/` the Visits today page, the Visits done report (admins), the check-in, photo, room and correction dialogs, the Agenda dialog's visit block and `preparePhoto.ts` (resize and redraw on the phone; visit strings start with `vis`); `quotes/` the Quotes area (admins); `invoices/` the Invoices list and page (admins) and the Bill dialog opened from a client's Invoices tab; `clients/` the Clients list and page (Staff see the ones they are scheduled for) and the `ClientPicker` used in the task, event and document forms; `settings/` the Notifications and Company settings cards; `public-quote/` the open quote form (its own page `quote.html` served at `/devis`, its own CSS copied from kmk-public and its own three-language strings; it imports nothing from the signed-in app); `lang.ts` has the language helpers; `locales/` has the four languages (fr-CA, en, pt-BR, es; the public quote form has its own three) (flat keys, every key must exist in all three; schedule strings start with `sch`, task strings with `task`).
- `deploy/` compose, Caddyfile, `.env.example`; `deploy/backup/` the backup scripts (backup, which also snapshots the visit photos, status, restore, installer, failure notifier, also for the purge (`notify-failure.sh purge`); plain unencrypted tar files written to the git-ignored `infrastructure/backups/`, never including `deploy/.env`) and their six systemd units (including the daily visit photo purge and its failure alert); `scripts/audit-deps.sh` scans dependencies.
- `infrastructure/` operations around the app: `deployments/` auto-deploy (polls GitHub, builds in a git-ignored worktree, systemd timer; installed on the owner's computer, so pushing `main` deploys to production), `utilities/` read-only helper scripts. Backup scripts stay in `deploy/backup/`; the backups themselves are written to `infrastructure/backups/` (git-ignored).
- `docs/superpowers/specs/` design documents; `docs/superpowers/plans/` implementation plans. `.superpowers/` is git-ignored scratch (progress ledgers).

## Commands

```bash
cd backend && .venv/bin/pytest -q                      # all backend tests (uses the kmk_test database only)
cd backend && .venv/bin/pytest -q -m "not slow"        # same without the backup-script tests (real pg_dump)
cd backend && .venv/bin/pytest -q --testmon            # while developing: only the tests the changed Python code can affect (first run is full and builds .testmondata; shell scripts and migrations are not tracked, so run the full suite before pushing)
cd backend && .venv/bin/alembic upgrade head           # migrate the database named by MIGRATION_DATABASE_URL
cd frontend && npx vitest run && npm run build         # frontend tests and production build
cd deploy && docker compose up -d --build              # rebuild and restart the stack (build the frontend first)
cd deploy && docker compose restart caddy              # needed after editing the Caddyfile (its admin API is off)
docker compose exec api python -m app.cli --help       # server-side commands (create-superadmin, reset-mfa)
```

Set up the backend once with `python3 -m venv backend/.venv && backend/.venv/bin/pip install -e 'backend[dev]'`
(the install is slow on a Python 3.14 host because some packages build from source).

## Conventions that matter

- **Every protected route uses the guard** (`app/auth/guard.py`): `Depends(guard())` for fully verified sessions,
  `guard(allow=(...), csrf=...)` only for deliberate exceptions. A test (`tests/test_mfa_guard.py`) calls every route in
  the API description with a half-authenticated session; a new route without a guard fails it. Public routes are listed in that test.
- **Authority rules live in one place:** `backend/app/auth/policy.py` (who may do what to whom) and `lifecycle.py` (account state changes). New admin actions go through `policy.check` first, and the `actions` list sent to the admin page comes from the same policy. Only the super admin manages admins (deliberate override of `scope.md`).
- **The runtime database role `kmk_app` cannot read the audit log** (INSERT only). Write audit rows with `audit.log(...)`
  (a plain INSERT, never `RETURNING`, never an ORM flush of the audit table). Migrations run as the owner role `kmk`.
- **Tests never use the real database.** `tests/conftest.py` forces the test database URLs. Per-test apps use `NullPool`
  because the Postgres server is shared with other apps and has a limited number of connections.
- **Test first**, and watch the test fail before implementing.
- **The compose file lists each container's environment explicitly** (so the API never gets the database owner's URL: only the one-shot `migrate` service does). A new API setting must be added to `api.environment` there. Deploy compose hardening one service at a time and watch its health (dropping all capabilities once stopped Caddy). The visit photo folder is the absolute host path `/var/lib/kmk/visit-photos` (`KMK_VISIT_PHOTOS_HOST_DIR`, the same default in the compose bind and in `deploy/backup/lib.sh`; never a path relative to the compose file, which auto-deploy runs from another worktree), a volume on `api` only, and must exist before the first deploy, owned by uid 10001 with the host user's group and mode 2750 (steps in `docs/operations.md`, "Visit photos"); the code never chmods a folder there (it would clear the setgid bit); `VISIT_PHOTOS_DIR` is fixed in the compose file, not in `.env`.
- **Backup scripts** are tested by `backend/tests/test_backup_scripts.py` (real shared Postgres through `docker exec`, `kmk_test` and temporary directories; it also covers the photo snapshot with its failure cases and the purge units); the Caddy body cap for photos is `@visitphoto` in the Caddyfile (restart Caddy after editing); restore trusts only archives whose hash the backup recorded.
- **Rate limiting** is serialized with advisory locks (`ratelimit.serialize`) on every endpoint that counts attempts; keep that when adding one.
- **Secrets** live only in git-ignored `.env` files (`deploy/.env`, `backend/.env`); never print them, commit them, or paste them into chat.
  Tokens, TOTP secrets, recovery codes and passwords must never reach logs or audit rows.
- Error bodies are `{"error": "<code>"}`; auth failures are deliberately generic (no account enumeration).
- New UI strings go into all three locale files; a test checks that the key sets match.
- **Versions:** the visible version is `major.minor.<commit count>` (Settings > About, `GET /api/version`). Raise the minor in `frontend/package.json` and `backend/pyproject.toml` for a release with user-visible changes; the third number is automatic (auto-deploy passes the commit, count and build time to the API image).
- Alembic migrations are written by hand as explicit SQL (no autogenerate); keep `app/models.py` in step.

## Working agreements

- Design is discussed and approved before a plan is written; plans are reviewed before execution. See the specs and plans for the history.
- Dashboard steps (Cloudflare, Resend), password prompts and anything involving the owner's own credentials are done by the owner, not by the assistant.
- Commit only when asked or when a plan says so; commit messages end with the Co-Authored-By trailer used in the existing history.
- Keep `docs/` accurate when behavior changes: operations (commands, settings), security (the model), roadmap (status).
