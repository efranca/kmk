# KMK app

Internal web app for **KMK Entretien Ménager**, live at **https://app.kmk-entretien.ca**. Invite-only sign-in for about 15
employees, with optional two-step verification, in French (CA), English and Portuguese (BR). It is the base for later
features (customer records, AI tools); see [docs/roadmap.md](docs/roadmap.md).

(The public marketing site for the company is a separate project, `kmk-public`, and is not part of this repository.)

## Where to start

| You want to... | Read |
| --- | --- |
| Understand the system and its status | [docs/README.md](docs/README.md) |
| Run, deploy, back up or fix it | [docs/operations.md](docs/operations.md) |
| Know why things were decided | [docs/decisions.md](docs/decisions.md) |
| Know how it is secured (and what was reviewed) | [docs/security.md](docs/security.md), [docs/security-review.md](docs/security-review.md) |
| Go live, or handle an incident | [docs/golive.md](docs/golive.md) |
| See what is next | [docs/roadmap.md](docs/roadmap.md) |
| Work on the code (also for AI coding sessions) | [CLAUDE.md](CLAUDE.md) |
| Read the original project plan | [scope.md](scope.md) (the plan; `docs/` describes what is actually built) |

## Stack

- **Backend:** Python 3.13 (container) with FastAPI, SQLAlchemy 2, Alembic, Argon2id, PyOTP. In `backend/`.
- **Frontend:** React + Vite + TypeScript, react-i18next. In `frontend/`.
- **Database:** PostgreSQL, a shared container on `127.0.0.1:5432` (database `kmk`).
- **Serving:** Caddy (container `kmk-caddy`) on `127.0.0.1:8081`, reached from the internet through a Cloudflare Tunnel.
  The API (container `kmk-api`) listens on `127.0.0.1:8001`. Compose files are in `deploy/`.

## Repository layout

```
backend/    FastAPI app (app/), migrations (alembic/), tests (tests/)
frontend/   React app (src/); `npm run build` produces dist/, which Caddy serves
deploy/     docker-compose.yml, Caddyfile, .env.example (the real .env is git-ignored); deploy/backup/ = encrypted backup scripts and timer
scripts/    scripts/audit-deps.sh: scan the Python and JavaScript dependencies for known vulnerabilities
docs/       documentation; docs/superpowers/ holds the design specs and implementation plans
scope.md    the original project plan
```

## Run the tests

```bash
# backend (needs backend/.env with the test database URLs, see docs/operations.md)
cd backend && .venv/bin/pytest -q            # 362 tests at the time of writing (about two minutes)

# frontend
cd frontend && npx vitest run && npm run build   # 98 tests
```

The backend tests only ever touch the `kmk_test` database, never the real `kmk` one.

## Deploy

```bash
cd frontend && npm run build
cd ../deploy && docker compose up -d --build
```

Full runbook, including the environment variables and backups: [docs/operations.md](docs/operations.md).
# kmk
