# Operations runbook

Everything needed to run, change and recover the system. Paths are relative to the repository root
(`/home/evandro/projects/kmk` on the host) unless absolute.

## What runs where

| Piece | Where | Notes |
| --- | --- | --- |
| API | container `kmk-api`, host network, `127.0.0.1:8001` | runs as a non-root user; applies migrations when it starts |
| Web server | container `kmk-caddy`, host network, `127.0.0.1:8081` | serves `frontend/dist` and proxies `/api/*`; named volume `kmk_caddy_data` |
| Database | shared container `postgres` (pgvector image), `127.0.0.1:5432` | database `kmk` for the app, `kmk_test` for tests; shared with famillai and others |
| Tunnel | container `famillai-cloudflared` | belongs to the famillai project; do not stop it casually, it also serves famillai |

The stack is one compose project, `kmk`, defined in `deploy/docker-compose.yml`.

## Start, stop, rebuild

```bash
cd frontend && npm run build                 # produces frontend/dist (Caddy serves it; the page is empty until you build)
cd deploy && docker compose up -d --build    # build and (re)start the API and Caddy
cd deploy && docker compose ps               # state
docker logs kmk-api --tail 50                # API log (also where the dev email backend prints messages)
docker logs kmk-caddy --tail 50              # access log (JSON)
cd deploy && docker compose down             # stop and remove the containers (the data volume and database stay)
```

- After editing `deploy/caddy/Caddyfile`, run `docker compose restart caddy` (Caddy's admin API is disabled, so it cannot reload by itself).
  Validate first: `docker run --rm -v "$PWD/deploy/caddy/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2.10.2 caddy validate --config /etc/caddy/Caddyfile`.
- Changing only `deploy/.env` needs `docker compose up -d` to recreate the API container with the new values.
- Changing only the frontend needs `npm run build`; Caddy serves the new files immediately.

## Environment variables (`deploy/.env`, git-ignored; template: `deploy/.env.example`)

| Variable | Default | Secret | Meaning |
| --- | --- | --- | --- |
| `DATABASE_URL` | none (required) | yes | runtime connection, as role `kmk_app` (`postgresql+psycopg://kmk_app:...@127.0.0.1:5432/kmk`) |
| `MIGRATION_DATABASE_URL` | falls back to `DATABASE_URL` | yes | owner role `kmk`; only Alembic uses it, at container start |
| `SESSION_SECRET` | `dev-only-change-me` | yes | signs per-session CSRF tokens; set a long random value (`openssl rand -hex 32`). Changing it invalidates CSRF tokens held by open pages (users just reload) |
| `COOKIE_SECURE` | `true` | no | `Secure` flag on the session cookie; keep `true` in production |
| `API_HOST`, `API_PORT` | `127.0.0.1`, `8001` | no | where the API listens; keep it on loopback |
| `EMAIL_BACKEND` | `log` | no | `log` prints each email (links included) to the API log, for development only; `resend` sends through Resend |
| `RESEND_API_KEY` | none | yes | Resend key, needed when `EMAIL_BACKEND=resend` |
| `EMAIL_FROM` | `KMK Entretien <no-reply@mail.kmk-entretien.ca>` | no | sender; the domain must be verified in Resend |
| `PUBLIC_BASE_URL` | `https://app.kmk-entretien.ca` | no | base of the links in emails |
| `MFA_ENCRYPTION_KEY` | none | **yes, back it up** | Fernet key that encrypts TOTP secrets. Without it the two-step endpoints answer 503 (login for users without TOTP still works) |
| `MFA_REQUIRED_ROLES` | empty | no | comma-separated roles forced to use TOTP (for example `admin,superadmin`); empty = nobody forced |

Further settings exist in `backend/app/config.py` with safe defaults (rate limits `rl_ip_max`=10, `rl_identifier_max`=5, `rl_window_minutes`=15,
`session_days`=5, `invite_hours`=48, `reset_minutes`=30, `allowed_origins`, `trusted_proxy_ips`, `mfa_issuer`); set them as upper-case environment variables if needed.
For local backend development and tests there is `backend/.env` (also git-ignored) with `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `TEST_DATABASE_URL`,
`TEST_APP_DATABASE_URL` and `SESSION_SECRET`.

## Database

- Roles: `kmk` (owner of the `kmk` database; runs migrations), `kmk_app` (runtime; full access to the tables except `audit_log`, where it can only INSERT),
  `kmk_test` (owner of the `kmk_test` database; used by the tests). `kmk_app` is a cluster-level role and also has access to `kmk_test`.
- Migrations live in `backend/alembic/versions/` and run automatically when the `kmk-api` container starts. By hand:
  `cd backend && .venv/bin/alembic upgrade head` (uses `MIGRATION_DATABASE_URL` from `backend/.env`; careful, `backend/.env` points at the real `kmk` database).
- Current revision: `docker exec postgres psql -U postgres -d kmk -Atc "select version_num from alembic_version"`.
- Inspect data as the superuser: `docker exec postgres psql -U postgres -d kmk`.
- The shared scripts `/home/evandro/projects/shared/scripts/pg-new-db.sh` (create a role and database) and `pg-backup.sh` read
  `/home/evandro/projects/shared/.env` (one level above the `scripts/` folder), which must define `POSTGRES_SUPERUSER`.
  That file does not exist on this machine, so both scripts fail here. The superuser is `postgres`; the `kmk` and `kmk_test`
  roles were created by running the script's SQL directly.

## Command-line tools (run on the server, inside the API container)

```bash
cd deploy
docker compose exec api python -m app.cli --help
# the first super admin (no sign-up exists). The password is typed at a hidden prompt; never put it on the command line.
docker compose exec api python -m app.cli create-superadmin --username NAME --email ADDRESS [--locale fr-CA|en|pt-BR]
# lost phone: remove someone's two-step verification, recovery codes and sessions
docker compose exec api python -m app.cli reset-mfa --username NAME
```

`create-superadmin` refuses if a super admin already exists. `reset-mfa` is audited (`mfa_reset`, via `cli`); the user then signs in with the password alone and can enroll again.

## Backups

- `pg-backup.sh` (in `/home/evandro/projects/shared/scripts/`) dumps every project database, roles included, into `/home/evandro/projects/shared/backups/` (one folder per database), keeping the last 10 per database.
  It covers `kmk`. It needs the shared `.env` described above to run.
- **Not covered by the database backup:** `deploy/.env`. Keep a copy of it somewhere safe. **Most important is `MFA_ENCRYPTION_KEY`:**
  without it every stored TOTP secret is unreadable and everyone with two-step verification would need `reset-mfa`.
  Also keep `SESSION_SECRET` and the database passwords (they can be reset, but the key cannot be recovered).
- A restore test has not been done yet (it is on the [roadmap](roadmap.md)).

## Email: switching from `log` to Resend

1. Resend: create the account, add the domain `mail.kmk-entretien.ca`, add the DNS records it shows in Cloudflare as **DNS only**, verify, add a DMARC record (`_dmarc`, start with `p=none`), create an API key restricted to sending for that domain.
2. In `deploy/.env` set `EMAIL_BACKEND=resend`, `RESEND_API_KEY=...`, and check `EMAIL_FROM` uses the verified domain.
3. `cd deploy && docker compose up -d`.
4. Test deliverability with an invite or reset to Gmail, Outlook and a Canadian provider; check SPF, DKIM and DMARC show as pass in the message headers.
5. While `EMAIL_BACKEND=log`, read a message with `docker logs kmk-api 2>&1 | grep -A8 'DEV EMAIL' | tail -12`. A failed send is audited as `email_failed` (no address or key in the row) and never changes the HTTP response.

## Turning on two-step verification enforcement

Two-step verification is encouraged, not forced. To force it for admins: set `MFA_REQUIRED_ROLES=admin,superadmin` in `deploy/.env` and run `docker compose up -d`.
Effect: a listed role without TOTP can only enroll, read its own state and sign out (including an already open session), and cannot disable TOTP.
Before doing it, make sure the key is backed up and `reset-mfa` works for you. To undo, empty the variable and recreate the container.

## Cloudflare settings that matter

- Zero Trust, Networking, Tunnels, the existing tunnel, Published application routes: `app` + `kmk-entretien.ca` to `http://localhost:8081`.
- SSL/TLS, Edge Certificates: **Always Use HTTPS** is on (so `http://` redirects with a 301).
- The "Flexible/Full" SSL mode does not matter for the origin here (the tunnel carries the traffic).

## Host requirements

- The system clock must be accurate (NTP); TOTP codes depend on it (a ±30 second window is accepted).
- Docker with Compose; Node.js and npm to build the frontend; Python 3 to run the backend tests locally.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Site shows an empty page or Caddy errors on `/` | `frontend/dist` is missing: run `npm run build` in `frontend/` |
| Caddyfile change has no effect | `docker compose restart caddy` (no live reload) |
| `kmk-api` restarts at once | read `docker logs kmk-api`; usually `.env` values (database URL or password) or a failed migration |
| `403 {"error":"forbidden"}` on a request you send with curl | mutating requests need an `Origin` header matching `allowed_origins` (`https://app.kmk-entretien.ca`) |
| Login always `429 too_many_attempts` | the 15-minute rate-limit window; wait, or delete rows in `login_attempts` as the superuser |
| MFA endpoints answer `503 mfa_unavailable` | `MFA_ENCRYPTION_KEY` missing, or different from the key that encrypted the stored secrets |
| Codes from the authenticator app are rejected | the host clock is off, or the code was already used (a code works once) |
| Backend tests fail with "remaining connection slots are reserved" | the shared Postgres is out of connections; the test fixtures use non-pooled connections for this reason, do not add long-lived engines to tests |
| `pg-new-db.sh` / `pg-backup.sh` fail on a missing `.env` | see the Database section |
| `pip install` takes minutes | some Python packages build from source on Python 3.14; wait, or use Python 3.13 for the virtualenv |
