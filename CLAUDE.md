# CLAUDE.md

Guidance for coding sessions (human or AI) in this repository. Read `docs/README.md` first for the architecture and status.

## What this is

The internal app behind https://app.kmk-entretien.ca (FastAPI backend, React frontend, shared Postgres, Caddy, Cloudflare Tunnel).
The product plan is `scope.md`; what is actually built is described in `docs/`.

## Layout

- `backend/app/` application code. `auth/` holds routes, the guard, services, rate limiting, audit, tokens, MFA. `emails/` is the mail layer. `mfa.py` and `security.py` are pure helpers. `cli.py` is the server-side admin tool.
- `backend/alembic/versions/` migrations (`0001` to `0004`). `backend/tests/` is the test suite.
- `frontend/src/` React app: `App.tsx` routes by path to the card pages (sign-in, recovery, two-step screens) or to the signed-in `Shell.tsx` (Welcome, Account, Admin pages); `lang.ts` has the language helpers; `welcomeContent.ts` lists the welcome page's content blocks; `locales/` has the three languages (every key must exist in all three).
- `deploy/` compose, Caddyfile, `.env.example`.
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
- **Secrets** live only in git-ignored `.env` files (`deploy/.env`, `backend/.env`); never print them, commit them, or paste them into chat.
  Tokens, TOTP secrets, recovery codes and passwords must never reach logs or audit rows.
- Error bodies are `{"error": "<code>"}`; auth failures are deliberately generic (no account enumeration).
- New UI strings go into all three locale files; a test checks that the key sets match.
- Alembic migrations are written by hand as explicit SQL (no autogenerate); keep `app/models.py` in step.

## Working agreements

- Design is discussed and approved before a plan is written; plans are reviewed before execution. See the specs and plans for the history.
- Dashboard steps (Cloudflare, Resend), password prompts and anything involving the owner's own credentials are done by the owner, not by the assistant.
- Commit only when asked or when a plan says so; commit messages end with the Co-Authored-By trailer used in the existing history.
- Keep `docs/` accurate when behavior changes: operations (commands, settings), security (the model), roadmap (status).
