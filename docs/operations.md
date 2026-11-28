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
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | empty | **private key: yes** | Web Push keys (see "Quote requests" below). Empty = no push is sent. Changing the pair turns every device's notifications off |
| `VAPID_SUBJECT` | `mailto:admin@kmk-entretien.ca` | no | contact the push services may use |

`VISIT_PHOTOS_DIR` (default `/data/visit-photos`, the folder inside the API container where visit photos are written) is not set in `deploy/.env`: the compose file fixes it for the `api` service and mounts `./data/visit-photos` there (the volume is on `api` only, not on `migrate` or Caddy). Details in "Visit photos" below.

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
docker compose exec api python -m app.cli create-superadmin --username NAME --email ADDRESS --name "Full Name" [--locale fr-CA|en|pt-BR|es]
# set or change anyone's display name (for example the first name of the super admin; the super admin can also do it on the admin page)
docker compose exec api python -m app.cli set-name --username NAME --name "Full Name"
# new Web Push keys (prints two lines for deploy/.env; touches no database)
docker compose exec api python -m app.cli vapid-keys
# lost phone: remove someone's two-step verification, recovery codes and sessions
docker compose exec api python -m app.cli reset-mfa --username NAME
# visit photos: delete the files of visits older than 6 months (rows stay) and files no row knows; prints purged=N orphans=M (run it daily)
docker compose exec api python -m app.cli purge-visit-photos
```

`create-superadmin` refuses if a super admin already exists. `reset-mfa` is audited (`mfa_reset`, via `cli`); the user then signs in with the password alone and can enroll again.

## Auto-deploy (optional)

`infrastructure/deployments/` can deploy every new `origin/main` by itself (frontend build, `docker compose up -d --build`, smoke check on `/` and `/api/health`). It is **not installed**; steps, settings and troubleshooting are in `infrastructure/deployments/README.md`. It also exports `APP_COMMIT`, `APP_COMMIT_COUNT` and `APP_BUILT_AT` so Settings > About shows the build (a hand-run `docker compose up -d --build` can export them the same way; without them the page says "Unknown").

## Backups

Verified and automatic, **not encrypted**. Scripts and units are in `deploy/backup/`; the backups are written inside the project, in `infrastructure/backups/` (git-ignored; the script creates it mode 700). It is on the same disk as the system and the database: see the limit below.

**What a backup is:** one plain file `daily/kmk-YYYY-MM-DD_HHMMSS.tar` (mode 600) containing the `kmk` database dump and a manifest (time, git commit, migration revision, row counts). **`deploy/.env` is deliberately not in it** (the script never reads it): the file holds the keys the database does not (`MFA_ENCRYPTION_KEY`, `SESSION_SECRET`, the database passwords), and without encryption it must not sit next to the dump. Keep your own copy of `deploy/.env` in your password manager (golive check 7); after a disaster you need it plus the dump. Retention: the newest **14** files by name (about two weeks); there are no weekly copies.

**Why it is safe enough unencrypted:** the dump holds password hashes, names and emails, and the TOTP secrets (encrypted with `MFA_ENCRYPTION_KEY`, which is not in the backup). Anyone who can read `infrastructure/backups/` can read the people's data, so do not copy, sync or share that folder (it is outside git on purpose), and keep your user account's files private.

**How it runs:** the systemd user timer `kmk-backup.timer` runs `kmk-backup.sh` daily at about 02:30 (a run missed because the computer was off happens at the next start; it works without a login). Each run: checks the database container is running; dumps the database into temporary storage; **verifies** the dump by restoring it into a scratch database and comparing row counts; writes the archive; records the outcome. A failure shows a desktop notification and is recorded in the status file.

**Install and check:**
```bash
deploy/backup/install.sh                          # installs and starts both timers (five units: backup service, timer and failure alert, photo purge service and timer); --dry-run shows what it would do, --uninstall removes them
systemctl --user list-timers kmk-backup.timer kmk-visit-photos-purge.timer   # next runs
systemctl --user start kmk-backup.service         # run a backup right now
deploy/backup/kmk-backup-status.sh                # last result and its age; exit code 1 if failed or older than 36 hours (--max-age-hours N)
journalctl --user -u kmk-backup.service -e        # the log of the last runs
```
`KMK_BACKUP_DEST` can point the backups somewhere else (for example another drive); the default is `infrastructure/backups`.

**Rehearse a restore (do it when the first backup exists, then every three months):** `deploy/backup/kmk-restore.sh <archive>` shows the manifest, restores the dump into a scratch database (`kmk_restore_test`), compares the row counts with the manifest, prints `RESTORE OK` and drops the scratch database. It never touches the live database.
The script only accepts archives that this computer's backup script wrote (their hash is kept in `~/.local/state/kmk-backup/archives.sha256`, outside the backup folder), because restoring runs SQL as the database superuser and anyone who can write to the backup folder could otherwise add an archive. After a reinstall that list is gone: then use `--accept-unverified`, but only when you are sure where the file came from.
Other options: `--extract-only DIR` writes the two files (mode 600) for the disaster procedure below; `--keep-scratch` keeps the restored scratch database for inspection (drop it afterwards).

**Restoring after a disaster** (the database is lost or damaged; everything since the last backup, up to a day, is lost). The rehearsal above proves steps 1 to 2 and the data; the steps were also run against a scratch database to confirm owners and the audit log's INSERT-only permissions come back correctly.
1. Pick the newest archive in `infrastructure/backups/daily/`.
2. Extract: `deploy/backup/kmk-restore.sh <archive> --extract-only ~/kmk-restore` (add `--accept-unverified` only after a reinstall and only if you trust the file). The folder holds `kmk.dump` and `MANIFEST.txt`.
3. If `deploy/.env` is gone, put back your copy from the password manager (`chmod 600 deploy/.env`); the backup does not contain it, and without `MFA_ENCRYPTION_KEY` nobody with two-step verification can sign in.
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
10. Securely delete `~/kmk-restore` (`shred -u` the dump), and run a new backup (`systemctl --user start kmk-backup.service`).

**Visit photos are backed up separately** (the database archive does not hold them): see "Visit photos" below, including how to restore them. `kmk-restore.sh` and the disaster steps above bring back the database only.

**Known limit:** `infrastructure/backups/` is on the same disk as the system and the database. The backups survive mistakes and a bad migration, but not a disk failure, theft or fire (and a reinstall that wipes the project folder takes them too). An off-site copy is a future step; because the archives are **not encrypted**, encrypt them first (for example with `gpg --symmetric`) before copying them anywhere.
The shared project scripts (`/home/evandro/projects/shared/scripts/pg-backup.sh`) are not used by kmk.

## Documents: disk, backups and limits

Document files are stored in the database, so the database and **every one of the 14 kept backups** grow with the library (at most 2 GB of files, times the copies kept by the backup rotation). Check free space on the host (`df -h /`) before large uploads; the library cap is `MAX_LIBRARY_BYTES` in `backend/app/documents/limits.py` (raise it deliberately, and consider moving backups off this disk first). Only `PUT /api/documents/{id}/file` accepts a large body (Caddy, 51 MiB), and `PUT .../preview` a 128 KB one; PDF previews use the pdf.js worker, a same-origin `.mjs` asset that Caddy serves as JavaScript (checked with the real Caddyfile); the API container's `mem_limit` is 1536m because one upload holds a few copies of the file (at most 2 uploads at once). After a Caddyfile change auto-deploy restarts Caddy by itself; by hand: `docker compose restart caddy`.

## Visit photos (check-in and check-out)

Photos of visits are **files on disk**, not rows in the database: the database keeps one row per photo (visit, room, size, SHA-256) and the file is `deploy/data/visit-photos/<first two characters of its id>/<id>` (random 32-character ids, never a name anyone typed). The folder is git-ignored (`deploy/data/`) and is mounted into the `api` container at `/data/visit-photos` (`VISIT_PHOTOS_DIR`). Photos are served only by the API, behind the sign-in and the visit's visibility rule; Caddy never serves the folder.

**Prepare the folder BEFORE the first deploy.** If the folder does not exist, Docker creates it owned by root and the API (uid 10001) cannot write to it. The photos must be writable by the container (uid 10001) and readable by the host user that runs the backup; files the container creates are mode 640 and folders 750, so give the folder the **host user's group** and the setgid bit, and everything created inside inherits that group. Run these from the project folder (`/home/evandro/projects/kmk`; all paths below are relative to it unless they start with `/`):

```bash
mkdir -p deploy/data/visit-photos
sudo chown 10001:$(id -gn) deploy/data/visit-photos
sudo chmod 2750 deploy/data/visit-photos
ls -ld deploy/data/visit-photos        # drwxr-s--- 10001 <your group> ...
```

Why: without the host group the files would belong to uid 10001 alone and the nightly backup (which runs as you) could not read them. An existing folder the backup cannot read is a **failed** backup, never a silent skip.

**Limits and disk.** One photo is at most 600 KB (the phone makes about 120 KB). Caddy lets only `PUT /api/visits/<id>/<date>/photos` carry a body up to 768 KB (`@visitphoto` in `deploy/caddy/Caddyfile`; every other API body stays at 64 KB), so **after the Caddyfile change run `docker compose restart caddy`**. The API refuses an upload with `503 storage_full` when the folder's disk has less than 1 GiB free (`MIN_FREE_BYTES` in `backend/app/visits/limits.py`). Photos are kept 6 months (183 days after the visit's date), so the folder holds about (photos per day) x 120 KB x 183: for example 50 photos a day is about 6 MB a day and about 1.1 GB for the six months. Backups add roughly one more copy of the photos (see below). Check `df -h /` monthly (routine in golive.md).

**The purge (6 months).** `kmk-visit-photos-purge.timer` runs `kmk-visit-photos-purge.service` daily at 03:15 (up to 10 minutes later; a run missed while the computer was off happens at the next start). It runs inside the API container: `docker compose -f deploy/docker-compose.yml exec -T api python -m app.cli purge-visit-photos`, which deletes the files of photos of visits older than 183 days (the row stays, marked purged, so counts and history remain), deletes files no row knows about (and stale `.tmp` files, only when older than an hour), and prints one line: `purged=N orphans=M`. By hand:

```bash
(cd deploy && docker compose exec -T api python -m app.cli purge-visit-photos)   # from the project folder
systemctl --user list-timers kmk-visit-photos-purge.timer
journalctl --user -u kmk-visit-photos-purge.service -e        # what the last runs printed
```

The purge does not touch the backup snapshots: a photo purged today still sits in the snapshots until the 14th newest one rolls off.

**Backing up the photos.** Each run of `kmk-backup.sh`, after the database archive is safely written, makes a snapshot of the photo folder in `infrastructure/backups/photos/<timestamp>/` (the same timestamp as the archive `kmk-<timestamp>.tar`) with `rsync`; unchanged files are hard links to the previous snapshot, so the snapshots together cost about one copy plus the new photos. The newest 14 snapshots are kept. Rules: a folder with no files, or a folder that does not exist, is skipped without a snapshot (so snapshots exist **only on days with photos**); an unreadable folder or unreadable file, a missing `rsync`, or a failed copy **fails the whole run** (status failed, desktop notification) and **nothing is deleted** (no pruning); rsync exit code 24 (a file vanished while copying, for example removed at that moment) is accepted. `KMK_BACKUP_PHOTOS_SRC` points the source somewhere else (empty = skip). The status line of a good run says `backup written (photos: N files)`. The snapshots are plain files like the archives: do not copy them off this machine unencrypted.

**Restoring photos.** `kmk-restore.sh` and the disaster steps restore the database only; they do **not** restore photos. After the database is back (or after losing the photo folder), copy a snapshot **into** the live folder `deploy/data/visit-photos/` (direction: from `infrastructure/backups/photos/<snapshot>/` to `deploy/data/visit-photos/`). Everything below runs from the project folder (`/home/evandro/projects/kmk`).
1. Pick the snapshot: snapshots exist only on days with photos, so take the newest one **at or before the timestamp of the archive you restored** (`ls infrastructure/backups/photos`; names are `YYYY-MM-DD_HHMMSS`). Photos taken after that moment have no row in the restored database and are simply not needed; rows whose file is missing show no picture (the API answers `404` for it).
2. Stop the API: `(cd deploy && docker compose stop api)`.
3. Copy with `sudo`, because the live folder belongs to uid 10001 (mode 2750), so you cannot write to it as yourself. The same command works when the folder was lost and when it survived (a surviving folder is the destination: nothing in it is deleted or replaced by older files, there is no `--delete` and no `rm`; a file that exists in both is overwritten only if the snapshot copy differs):
```bash
sudo mkdir -p deploy/data/visit-photos
sudo rsync -a --chown=10001:$(id -gn) --chmod=D2750,F640 infrastructure/backups/photos/<snapshot>/ deploy/data/visit-photos/
sudo chown 10001:$(id -gn) deploy/data/visit-photos
sudo chmod 2750 deploy/data/visit-photos
ls -ld deploy/data/visit-photos        # drwxr-s--- 10001 <your group>
```
The owner and mode step is **required**, not optional: the backup stores snapshots as folders 700 and files 600 owned by you, so a plain `rsync -a` would leave files that the API container (uid 10001) cannot read. `--chown` and `--chmod` fix the copied files (folders 750 with the setgid bit, files 640, owner 10001, your group) and the last two commands fix the root folder itself. If you copied some other way, fix it afterwards with `sudo chown -R 10001:$(id -gn) deploy/data/visit-photos`, `sudo find deploy/data/visit-photos -type d -exec chmod 2750 {} +` and `sudo find deploy/data/visit-photos -type f -exec chmod 640 {} +`.
4. Start the API again: `(cd deploy && docker compose up -d)`.
5. A restore can bring back photos the 6-month purge had already deleted (they live on in older snapshots). That is harmless; run the purge by hand to delete them again: `(cd deploy && docker compose exec -T api python -m app.cli purge-visit-photos)`.
6. Open a visit that has photos and check they show; run a backup (`systemctl --user start kmk-backup.service`) and check the status line says the photo files were counted.

**Deploy steps for the owner, in order** (each command runs from the project folder `/home/evandro/projects/kmk`; the code is finished and tested; nothing below has been run on the live system):
1. Check the disk: `df -h /` (the guard stops uploads under 1 GiB free).
2. Migrate (creates the visits tables, as the owner role): `(cd deploy && docker compose run --rm migrate)`, then `docker exec postgres psql -U postgres -d kmk -Atc "select version_num from alembic_version"` must print `0024`.
3. Create the folder with the commands in "Prepare the folder" above (`mkdir -p`, `sudo chown 10001:$(id -gn)`, `sudo chmod 2750`, from the project folder).
4. Build the frontend and start: `(cd frontend && npm run build)`, then `(cd deploy && docker compose up -d --build)`. Check `(cd deploy && docker compose ps)` shows `kmk-api` healthy and `(cd deploy && docker compose exec api ls -ld /data/visit-photos)` shows the folder (owner `10001`). Until step 5 is done, Caddy still has the old body limit and photo uploads fail; do not test photos before it.
5. `(cd deploy && docker compose restart caddy)` (the Caddyfile has the new photo rule; this makes uploads work). Check `docker logs kmk-caddy --tail 20` has no error.
6. Install the timers: `deploy/backup/install.sh` (or `--dry-run` first). Check `systemctl --user list-timers kmk-backup.timer kmk-visit-photos-purge.timer` shows both with a next run. Install `rsync` first if `rsync --version` fails.
7. Check Settings > About shows version `0.6.<n>`.
8. Make a test visit (below), then run a first backup: `systemctl --user start kmk-backup.service`, then `deploy/backup/kmk-backup-status.sh` says OK with `photos: N files`, and `ls infrastructure/backups/photos` shows the snapshot.
9. Rehearse the restore, including photos: `deploy/backup/kmk-restore.sh <newest archive>` (prints `RESTORE OK`), and the photo copy as a dry run into a scratch folder (never into the live one): `rsync -a infrastructure/backups/photos/<snapshot>/ /tmp/photos-check/`, then compare the file counts (`find /tmp/photos-check -type f | wc -l` and the same for the snapshot) and delete `/tmp/photos-check`.
10. Run the purge by hand once: it should print `purged=0 orphans=0`.

**What to test on real phones before relying on it** (not tried on real devices while building): an Agenda item for a client's property with you and a colleague listed; check in yourself and the colleague; take **portrait** photos with the camera on an iPhone and on an Android phone (open the visit's photo after uploading: it must be upright, not rotated; the browser is asked to follow the picture's own orientation and this was not verified on real devices); choose a photo from the gallery; try a bad-signal upload (airplane mode in the middle: the button must recover and a retry must work); check the photo carries no location (save it from the browser and look at its properties); check out with "photos required" on and off; make a correction. Also confirm in the browser that the photo shows (no CSP problem).

## Container limits, logs and health

- Logs: both containers keep at most 5 files of 10 MB (`docker inspect kmk-api --format '{{json .HostConfig.LogConfig}}'`). Health: `docker inspect --format '{{.Name}} {{.State.Health.Status}}' kmk-api kmk-caddy` (checks `/api/health` every 30 seconds).
- Limits: api 1 GB of memory, caddy 512 MB, 256 processes each; all Linux capabilities dropped (Caddy keeps only `NET_BIND_SERVICE`, which its binary needs to start), no privilege escalation.
- Host (checked, not changed by kmk): Docker starts at boot and both containers restart on failure (`unless-stopped`); the clock is synchronized; Ubuntu security updates are applied automatically (`apt-daily-upgrade.timer`, `unattended-upgrades`).

## Checking dependencies

The schedule added `python-dateutil` (backend) and `react-router`, `@tanstack/react-query` (frontend); nothing in `deploy/.env` changes for it. Migration `0006_schedule` creates the five schedule tables and runs with the other migrations at stack start (`docker compose run --rm migrate`).

`scripts/audit-deps.sh` scans the installed Python packages (`pip-audit`) and the production JavaScript packages (`npm audit`, high or worse). It needs network access, exits non-zero on findings, and should be run before every deploy.

## Quote requests (the open form at `/devis`)

- **The form** is `frontend/quote.html`, served by Caddy at `https://app.kmk-entretien.ca/devis` (also `/devis/`), in French by default; `?lang=fr` and `?lang=en` preselect a language (French and English only). Put a link to it on the public site's contact pages (the old web3forms form there is not touched by this app).
- **Limits:** 10 started requests per hour per IP (IPv6 per /64), at most 10 photos of 8 MiB and 200 MiB of photos per IP in 24 hours, at most 2000 words and 20 000 characters. Unfinished drafts are deleted after 2 hours; photos of unfinished drafts are capped at 300 MB in total (`503 busy` over that). Caddy caps the bodies: 256 KB for the first call, 9 MiB for a photo.
- **First-time setup (owner steps):**
  1. Generate the push keys: `docker compose exec api python -m app.cli vapid-keys`, put the two lines in `deploy/.env`, then `docker compose up -d` to restart the API.
  2. In Resend, verify the domain of the quote sender (for example `mail.kmk-entretien.com`) and keep `EMAIL_BACKEND=resend`.
  3. As super admin, open Settings > Company settings and fill: the notification email, the quote sender (`KMK Entretien <devis@mail.kmk-entretien.com>`), the Reply-To (the Gmail the team reads) and the public phone number. Replies to customers are refused (`sender_not_configured`) until the sender is set.
  3b. Per-person quote emails: an administrator opens a person in Users and ticks "Receives quote requests"; that person then gets an email with a link for each new request (the notification address above still gets its copy). Staff never receive them.
  3c. Everyone gets an email when added to an Agenda item (Settings > Notifications, on by default; each person can turn it off).
  4. Each admin turns on Settings > Notifications on their devices. On iPhone, the app must be added to the Home Screen first (the app is installable: manifest and icons).
- **Customer replies** arrive in the team's Gmail (through the Reply-To), not in the app: paste them with "Add customer reply" on the quote so the history stays complete. There is no inbound email.
- **Troubleshooting:** no push after turning it on → check `VAPID_*` are in the API's environment (`docker compose exec api env | grep VAPID`) and that the browser allowed notifications; a reply marked "Not sent" → the sender's domain is not verified in Resend, or the provider is down (use "Try again").

## Invoices

- **Numbering:** the company's own invoices reached 006 outside the app, so the first invoice made here is **007**. The number is `max(number) + 1` (or 7 when there are none), taken under an advisory lock, so numbers are gap-free and two admins billing at once cannot collide. A cancelled invoice keeps its number; invoices are never deleted. To start from another number, insert one row with the number just below it (a cancelled invoice with no lines does it), or change `FIRST_NUMBER` in `backend/app/invoices/service.py`.
- **Where the company block and logo live:** `backend/app/invoices/pdf.py` (name, Lévis, phone, email, site, NEQ, the thank-you line) and `backend/app/invoices/assets/` (`logo.png`, a copy of `frontend/public/logo-horizontal.png`, and the three Liberation Sans fonts with their licence). Change them there and redeploy; nothing is set in Settings. The PDF is French only.
- **Stored PDF:** each invoice's PDF is generated once, when it is created, and kept as a Document (visibility "admins", linked to the client, category "Factures", file `Facture-007.pdf`). It follows the library's backups and limits. If someone deletes that document, the invoice still downloads (drawn again from its snapshot).
- **Prices:** the price of one visit is set on the property (client page, Properties). No tax is calculated: the TVA line prints 0,00 $.
- **Email:** the invoice email uses the quote sender settings (Settings > Company settings: sender and Reply-To) and the normal email backend; the PDF travels as an attachment. A failed send changes nothing and can be tried again.
- **Dependency:** the PDF is drawn with `fpdf2` (and Pillow); `scripts/audit-deps.sh` covers them.

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

## Calendar feed links

- A user creates, replaces or revokes their link on the Account page (Calendar feed card). The link is shown once; a lost link means creating a new one.
- Revoke someone's link by hand (lost phone, a link that leaked): `docker exec postgres psql -U postgres -d kmk -c "DELETE FROM calendar_feeds WHERE user_id = (SELECT id FROM users WHERE username = '<username>')"`. Disabling the account also stops it.
- Subscribing apps: FamillAI (My calendars, Connect a calendar) refreshes about every 10 minutes; Google Calendar (Other calendars, From URL) refreshes on its own schedule, often hours.
- **Owner step: keep links out of Caddy's log.** Caddy logs the full path, token included. A filter on the `log` directive should redact it; this was **not tested** (no Caddy binary was available while it was written), so check it with `caddy validate` and one request before relying on it:
  ```
  log {
  	format filter {
  		request>uri regexp ^/api/schedule/feed/[^/?]+ /api/schedule/feed/[redacted]
  	}
  }
  ```
  Then `docker compose restart caddy` and confirm `docker logs caddy` shows `[redacted]`. Until then, treat `docker logs caddy` as holding secrets.
- If an app says it cannot read the link, check Cloudflare's Security events for `/api/schedule/feed/`: a bot challenge there blocks server-side fetchers. The fix is a skip rule for that path only.

## Cloudflare settings that matter

- Zero Trust, Networking, Tunnels, the existing tunnel, Published application routes: `app` + `kmk-entretien.ca` to `http://localhost:8081`.
- SSL/TLS, Edge Certificates: **Always Use HTTPS** is on (so `http://` redirects with a 301).
- Rules, Settings, **Managed Transforms**: turn on **Add visitor location headers** so the Devices page can show the city (without it only the country shows). Then `docker compose restart caddy` is not needed (the Caddyfile already passes the headers on).
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
| The backup status says failed or is old | `deploy/backup/kmk-backup-status.sh`, then `journalctl --user -u kmk-backup.service -e`; common causes: the database container stopped, no free space (the script needs 500 MB) |
| `403 {"error":"forbidden"}` on a request you send with curl | mutating requests need an `Origin` header matching `allowed_origins` (`https://app.kmk-entretien.ca`) |
| Login always `429 too_many_attempts` | the 15-minute rate-limit window; wait, or delete rows in `login_attempts` as the superuser |
| MFA endpoints answer `503 mfa_unavailable` | `MFA_ENCRYPTION_KEY` missing, or different from the key that encrypted the stored secrets |
| Codes from the authenticator app are rejected | the host clock is off, or the code was already used (a code works once) |
| Backend tests fail with "remaining connection slots are reserved" | the shared Postgres is out of connections; the test fixtures use non-pooled connections for this reason, do not add long-lived engines to tests |
| Uploading a visit photo answers `503 storage_full` | the disk under `deploy/data/visit-photos` has less than 1 GiB free (or the folder cannot be read): `df -h /`, free space (old backups, Docker images: `docker system df`); photos older than 6 months leave by the nightly purge |
| A visit photo upload answers `503` with `busy`, or the photo never arrives | at most 2 photos are processed at once and a photo has 60 seconds to arrive: retry; if every upload fails check `docker logs kmk-api --tail 50` and that Caddy was restarted after the Caddyfile change (`@visitphoto`, 768KB) |
| Every photo upload fails with a permission error in `docker logs kmk-api` | the folder is not writable by uid 10001: `ls -ld deploy/data/visit-photos`, then redo `sudo chown 10001:$(id -gn)` and `sudo chmod 2750` on it (see Visit photos) |
| The backup status says failed with "photo folder ... cannot be read" (photos NOT backed up) | the backup user cannot read the folder or a file in it (the folder was created by Docker as root, or files have the wrong group): fix owner, group and mode as in Visit photos (`sudo chown -R 10001:$(id -gn)`, setgid `2750` folders, `640` files), then run the backup again; a failed photo step deletes nothing |
| The backup status says failed with "rsync is not installed" | `sudo apt install rsync`, then run the backup again |
| `kmk-visit-photos-purge.service` fails | `journalctl --user -u kmk-visit-photos-purge.service -e`: usually the stack is down (`docker compose exec` cannot reach the `api` container); start it with `cd deploy && docker compose up -d` and run the purge by hand (`docker compose exec -T api python -m app.cli purge-visit-photos`); the timer tries again the next day on its own |
| `pg-new-db.sh` / `pg-backup.sh` fail on a missing `.env` | see the Database section (kmk's own backup does not use them) |
| `pip install` takes minutes | some Python packages build from source on Python 3.14; wait, or use Python 3.13 for the virtualenv |
