# Operations runbook

Everything needed to run, change and recover the system. Paths are relative to the repository root
(`/home/evandro/projects/kmk` on the host) unless absolute.

## What runs where

| Piece | Where | Notes |
| --- | --- | --- |
| API | container `kmk-api`, host network, `127.0.0.1:8001` | runs as a non-root user; does **not** hold the database owner credentials |
| Migrations | one-shot container `kmk-migrate` | runs `alembic upgrade head` with the owner credentials each time the stack starts, then exits; the API starts after it succeeds |
| Web server | container `kmk-caddy`, host network, `127.0.0.1:8081` | serves `frontend/dist` and proxies `/api/*`; named volume `kmk_caddy_data` |
| Database | shared container `postgres` (pgvector image), `127.0.0.1:5432` | database `kmk` for the app, `kmk_test` for tests; shared with famillai and others |
| Tunnel | container `famillai-cloudflared` | belongs to the famillai project; do not stop it casually, it also serves famillai |

The stack is one compose project, `kmk`, defined in `deploy/docker-compose.yml`.

## Start, stop, rebuild

```bash
cd frontend && npm run build                 # produces frontend/dist (Caddy serves it; the page is empty until you build)
cd deploy && docker compose up -d --build    # build, migrate (one-shot), then (re)start the API and Caddy
cd deploy && docker compose run --rm migrate # run the migrations by hand
cd deploy && docker compose ps               # state
docker logs kmk-api --tail 50                # API log (also where the dev email backend prints messages)
docker logs kmk-caddy --tail 50              # access log (JSON)
cd deploy && docker compose down             # stop and remove the containers (the data volume and database stay)
```

- After editing `deploy/caddy/Caddyfile`, run `docker compose restart caddy` (Caddy's admin API is disabled, so it cannot reload by itself).
  Validate first: `docker run --rm -v "$PWD/deploy/caddy/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2.10.2 caddy validate --config /etc/caddy/Caddyfile`.
- Changing only `deploy/.env` needs `docker compose up -d` to recreate the API container with the new values. The compose file lists, per service, exactly the variables it passes on (`environment:` in `deploy/docker-compose.yml`): **a new setting for the API must be added there** or it never reaches the container.
- Changing hardening in the compose file (capabilities, limits): deploy one service at a time and watch its health, because a mistake can stop a container from starting (dropping every capability once stopped Caddy: its binary needs `NET_BIND_SERVICE`).
- Changing only the frontend needs `npm run build`; Caddy serves the new files immediately.

## Environment variables (`deploy/.env`, git-ignored; template: `deploy/.env.example`)

| Variable | Default | Secret | Meaning |
| --- | --- | --- | --- |
| `DATABASE_URL` | none (required) | yes | runtime connection, as role `kmk_app` (`postgresql+psycopg://kmk_app:...@127.0.0.1:5432/kmk`) |
| `MIGRATION_DATABASE_URL` | falls back to `DATABASE_URL` | yes | owner role `kmk`; passed **only** to the one-shot `migrate` container, never to the API |
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
- Migrations live in `backend/alembic/versions/` and run automatically as the one-shot `migrate` container whenever the stack starts (`docker compose up -d`). By hand: `cd deploy && docker compose run --rm migrate`, or from the host `cd backend && .venv/bin/alembic upgrade head` (uses `MIGRATION_DATABASE_URL` from `backend/.env`; careful, `backend/.env` points at the real `kmk` database).
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
docker compose exec api python -m app.cli create-superadmin --username NAME --email ADDRESS --name "Full Name" [--locale fr-CA|en|pt-BR]
# set or change anyone's display name (for example the first name of the super admin; the super admin can also do it on the admin page)
docker compose exec api python -m app.cli set-name --username NAME --name "Full Name"
# lost phone: remove someone's two-step verification, recovery codes and sessions
docker compose exec api python -m app.cli reset-mfa --username NAME
```

`create-superadmin` refuses if a super admin already exists. `reset-mfa` is audited (`mfa_reset`, via `cli`); the user then signs in with the password alone and can enroll again.

## Auto-deploy (optional)

`infrastructure/deployments/` can deploy every new `origin/main` by itself (frontend build, `docker compose up -d --build`, smoke check on `/` and `/api/health`). It is **not installed**; steps, settings and troubleshooting are in `infrastructure/deployments/README.md`.

## Backups

Encrypted, verified, automatic. Scripts and units are in `deploy/backup/`; the destination is `/mnt/shared/BACKUPS/kmk` (a partition on the same SSD as the system: see the limit below).

**What a backup is:** one encrypted file `daily/kmk-YYYY-MM-DD_HHMMSS.tar.gpg` (plus a copy in `weekly/` on Sundays) containing the `kmk` database dump, a copy of `deploy/.env` (the keys the database does not hold: `MFA_ENCRYPTION_KEY`, `SESSION_SECRET`, the database passwords) and a manifest (time, git commit, migration revision, row counts). Retention: newest 14 daily and 8 weekly files, by name.

**How it runs:** the systemd user timer `kmk-backup.timer` runs `kmk-backup.sh` daily at about 02:30 (a run missed because the computer was off happens at the next start; it works without a login). Each run:
refuses to start unless `/mnt/shared` is really mounted and the database container is running; dumps the database into memory-backed storage; **verifies** the dump by restoring it into a scratch database and comparing row counts; encrypts with the **public** key; records the outcome. A failure shows a desktop notification and is recorded in the status file.

**The key (done once, by you):** run in a normal terminal window `deploy/backup/make-backup-key.sh --private-out ~/kmk-backup-private-key.asc`. You choose a passphrase; copy the private key and the passphrase into your password manager, then delete the file. Only the public key stays on this computer (`~/.config/kmk-backup/recipient.pub.asc`).
Whoever has the private key **and** the passphrase can read every backup; without them the backups can never be restored. Never keep them on this computer or on `/mnt/shared`.

**Install and check:**
```bash
deploy/backup/install.sh                          # installs and starts the timer (refuses until the public key exists); --dry-run shows what it would do, --uninstall removes it
systemctl --user list-timers kmk-backup.timer     # next run
systemctl --user start kmk-backup.service         # run a backup right now
deploy/backup/kmk-backup-status.sh                # last result and its age; exit code 1 if failed or older than 36 hours (--max-age-hours N)
journalctl --user -u kmk-backup.service -e        # the log of the last runs
```

**Rehearse a restore (do it when the first backup exists, then every three months):** `deploy/backup/kmk-restore.sh <archive> --private-key <key file>` decrypts the archive, shows the manifest, restores it into a scratch database (`kmk_restore_test`), compares the row counts with the manifest, prints `RESTORE OK` and drops the scratch database. It never touches the live database. Get the private key out of the password manager into a temporary file (mode 600) and delete it afterwards.
The script only accepts archives that this computer's backup script wrote (their hash is kept in `~/.local/state/kmk-backup/archives.sha256`, on the Linux disk), because restoring runs SQL as the database superuser and anyone who can write to the shared partition could otherwise add an archive. After a reinstall that list is gone: then use `--accept-unverified`, but only when you are sure where the file came from.
Other options: `--extract-only DIR` writes the three files (mode 600) for the disaster procedure below; `--keep-scratch` keeps the restored scratch database for inspection (drop it afterwards).

**Restoring after a disaster** (the database is lost or damaged; everything since the last backup, up to a day, is lost). The rehearsal above proves steps 1 to 2 and the data; the steps were also run against a scratch database to confirm owners and the audit log's INSERT-only permissions come back correctly.
1. Put your private key from the password manager into a temporary file (mode 600). Pick the newest archive in `/mnt/shared/BACKUPS/kmk/daily/` (or `weekly/`).
2. Extract: `deploy/backup/kmk-restore.sh <archive> --private-key <key file> --extract-only ~/kmk-restore` (add `--accept-unverified` only after a reinstall and only if you trust the file). The folder holds `kmk.dump`, `deploy.env`, `MANIFEST.txt`.
3. If `deploy/.env` is gone: `cp ~/kmk-restore/deploy.env deploy/.env && chmod 600 deploy/.env`.
4. Stop the application: `cd deploy && docker compose stop caddy api`.
5. Recreate the roles (their passwords come from `deploy/.env`; this snippet reads them without printing them):
```bash
docker exec -i postgres psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kmk') THEN CREATE ROLE kmk LOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kmk_app') THEN CREATE ROLE kmk_app LOGIN; END IF; END \$\$;"
cd deploy && python3 - <<'PY'
import re, subprocess
env = dict(l.split("=", 1) for l in open(".env").read().splitlines() if "=" in l and not l.startswith("#"))
pw = lambda url: re.search(r"://[^:]+:([^@]+)@", url).group(1)
sql = f"ALTER ROLE kmk PASSWORD '{pw(env['MIGRATION_DATABASE_URL'])}'; ALTER ROLE kmk_app PASSWORD '{pw(env['DATABASE_URL'])}';"
subprocess.run(["docker", "exec", "-i", "postgres", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], input=sql.encode(), check=True)
PY
```
6. Recreate the database: `docker exec -i postgres psql -U postgres -d postgres -c "DROP DATABASE IF EXISTS kmk WITH (FORCE)" -c "CREATE DATABASE kmk OWNER kmk" -c "REVOKE ALL ON DATABASE kmk FROM PUBLIC" -c "GRANT CONNECT ON DATABASE kmk TO kmk_app"`.
7. Restore with owners and permissions (do **not** use `--no-owner` here): `docker exec -i postgres pg_restore -U postgres -d kmk --exit-on-error < ~/kmk-restore/kmk.dump`.
8. Check: `docker exec postgres psql -U postgres -d kmk -Atc "select p, has_table_privilege('kmk_app','public.audit_log',p) from unnest(array['SELECT','INSERT','UPDATE','DELETE']) p"` must show only INSERT as `t`; compare table counts with `~/kmk-restore/MANIFEST.txt`.
9. Start: `cd deploy && docker compose up -d` (the migrate step is a no-op when the revision is current), check `curl -s https://app.kmk-entretien.ca/api/health` and sign in.
10. Securely delete `~/kmk-restore` and the key file (`shred -u`), and run a new backup (`systemctl --user start kmk-backup.service`).

**Known limit:** `/mnt/shared` is on the same physical SSD as the system. The backups survive mistakes, a Linux reinstall and filesystem damage, but not an SSD failure, theft or fire. An off-site copy (external drive or cloud) is a future step; because the archives are encrypted, copying them anywhere is safe.
The shared project scripts (`/home/evandro/projects/shared/scripts/pg-backup.sh`) are not used by kmk.

## Container limits, logs and health

- Logs: both containers keep at most 5 files of 10 MB (`docker inspect kmk-api --format '{{json .HostConfig.LogConfig}}'`). Health: `docker inspect --format '{{.Name}} {{.State.Health.Status}}' kmk-api kmk-caddy` (checks `/api/health` every 30 seconds).
- Limits: api 1 GB of memory, caddy 512 MB, 256 processes each; all Linux capabilities dropped (Caddy keeps only `NET_BIND_SERVICE`, which its binary needs to start), no privilege escalation.
- Host (checked, not changed by kmk): Docker starts at boot and both containers restart on failure (`unless-stopped`); the clock is synchronized; Ubuntu security updates are applied automatically (`apt-daily-upgrade.timer`, `unattended-upgrades`).

## Checking dependencies

The schedule added `python-dateutil` (backend) and `react-router`, `@tanstack/react-query` (frontend); nothing in `deploy/.env` changes for it. Migration `0006_schedule` creates the five schedule tables and runs with the other migrations at stack start (`docker compose run --rm migrate`).

`scripts/audit-deps.sh` scans the installed Python packages (`pip-audit`) and the production JavaScript packages (`npm audit`, high or worse). It needs network access, exits non-zero on findings, and should be run before every deploy.

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
| `kmk-api` restarts at once | read `docker logs kmk-api`; usually `.env` values (database URL or password) |
| `docker compose up` stops at `kmk-migrate` | read `docker logs kmk-migrate`: a failed migration or a wrong `MIGRATION_DATABASE_URL`; the API does not start until it succeeds |
| `kmk-caddy` restarts with `exec /usr/bin/caddy: operation not permitted` | a hardening change removed the capability the Caddy binary needs: keep `cap_add: [NET_BIND_SERVICE]` |
| A new `.env` setting has no effect on the API | add it to the `api` service's `environment:` in `deploy/docker-compose.yml` |
| The backup status says failed or is old | `deploy/backup/kmk-backup-status.sh`, then `journalctl --user -u kmk-backup.service -e`; common causes: `/mnt/shared` not mounted, the database container stopped, the public key missing |
| `403 {"error":"forbidden"}` on a request you send with curl | mutating requests need an `Origin` header matching `allowed_origins` (`https://app.kmk-entretien.ca`) |
| Login always `429 too_many_attempts` | the 15-minute rate-limit window; wait, or delete rows in `login_attempts` as the superuser |
| MFA endpoints answer `503 mfa_unavailable` | `MFA_ENCRYPTION_KEY` missing, or different from the key that encrypted the stored secrets |
| Codes from the authenticator app are rejected | the host clock is off, or the code was already used (a code works once) |
| Backend tests fail with "remaining connection slots are reserved" | the shared Postgres is out of connections; the test fixtures use non-pooled connections for this reason, do not add long-lived engines to tests |
| `pg-new-db.sh` / `pg-backup.sh` fail on a missing `.env` | see the Database section (kmk's own backup does not use them) |
| `pip install` takes minutes | some Python packages build from source on Python 3.14; wait, or use Python 3.13 for the virtualenv |
