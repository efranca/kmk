# CLAUDE.md

Guidance for coding sessions (human or AI) in this repository. Read `docs/README.md` first for the architecture and status.

## What this is

The internal app behind https://app.kmk-entretien.ca (FastAPI backend, React frontend, shared Postgres, Caddy, Cloudflare Tunnel).
The product plan is `scope.md`; what is actually built is described in `docs/`.

## Layout

- `backend/app/` application code. `auth/` holds routes, the guard, services, rate limiting, audit, tokens, MFA. `emails/` is the mail layer. `mfa.py` and `security.py` are pure helpers. `cli.py` is the server-side admin tool.
- `backend/app/schedule/` the shared calendar: `recurrence.py` (repeat rule, `rrule`), `occurrences.py` (expansion with one-off changes), `service.py`, `routes.py`.
- `backend/alembic/versions/` migrations (`0001` to `0010`). `backend/tests/` is the test suite.
- `backend/app/tasks/` the task list and its categories: `schemas.py`, `service.py`, `routes.py`.
- `frontend/src/` React app: `App.tsx` routes by path to the card pages (sign-in, recovery, two-step screens) or to the signed-in `Shell.tsx` / `app/Layout.tsx` (Dashboard, Schedule, Account, Admin pages); `schedule/` (views, event dialog, drag, reminders), `dashboard/` (the three widgets: My events, All events, My tasks), `tasks/` (the task list, dialog, categories) and `ui/` (shared pieces) hold the calendar; `lang.ts` has the language helpers; `locales/` has the three languages (flat keys, every key must exist in all three; schedule strings start with `sch`, task strings with `task`).
- `deploy/` compose, Caddyfile, `.env.example`; `deploy/backup/` the encrypted backup scripts (backup, status, restore, key ceremony, installer, failure notifier) and their systemd units; `scripts/audit-deps.sh` scans dependencies.
- `infrastructure/` operations around the app: `deployments/` auto-deploy (polls GitHub, builds in a git-ignored worktree, systemd timer; not installed until the owner runs its install steps), `utilities/` read-only helper scripts. Backups stay in `deploy/backup/`.
- `docs/superpowers/specs/` design documents; `docs/superpowers/plans/` implementation plans. `.superpowers/` is git-ignored scratch (progress ledgers).

## Commands

```bash
cd backend && .venv/bin/pytest -q                      # all backend tests (uses the kmk_test database only)
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
- **The compose file lists each container's environment explicitly** (so the API never gets the database owner's URL: only the one-shot `migrate` service does). A new API setting must be added to `api.environment` there. Deploy compose hardening one service at a time and watch its health (dropping all capabilities once stopped Caddy).
- **Backup scripts** are tested by `backend/tests/test_backup_scripts.py` (real shared Postgres through `docker exec`, `kmk_test`, temporary directories and a throwaway key); restore trusts only archives whose hash the backup recorded.
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
