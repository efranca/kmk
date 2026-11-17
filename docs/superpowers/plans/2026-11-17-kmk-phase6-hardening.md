# kmk Phase 6 (Hardening and go-live) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Encrypted, verified, automated backups of the `kmk` database and `deploy/.env` into `/mnt/shared/BACKUPS/kmk`; Docker log rotation and health checks; dependency scanning; a documented and independently reviewed security posture; and a go-live checklist with an incident runbook.

**Architecture:** Bash scripts in `deploy/backup/` (backup, status, restore, key ceremony, install, failure notifier) driven by a systemd user timer. The backup dumps through `docker exec postgres pg_dump`, verifies by restoring into a scratch database and comparing row counts, then encrypts the archive to a **public** key with `gpg` (the private key never lives on this machine). Tests for the scripts live in `backend/tests/` (pytest running the scripts with environment overrides against `kmk_test`, temporary destinations and a temporary test key).

**Tech Stack:** bash, `gpg` 2.4, `tar`, `docker exec` into the shared `postgres` container, systemd user units, `pip-audit`, `npm audit`; documentation in Markdown.

**Spec:** `docs/superpowers/specs/2026-11-17-phase6-hardening-design.md` (also `docs/security.md`, `docs/operations.md`, `docs/roadmap.md`, `scope.md` §8 and §11-§12)

## Global Constraints

- **Destination and encryption (owner's choice):** `/mnt/shared/BACKUPS/kmk`, always encrypted. `/mnt/shared` is an NTFS partition on the same SSD as the system and is mounted with `nofail`: the backup refuses to run unless that path's mount root (`/mnt/shared`) is a real mountpoint, so it can never fill the system disk by writing into an unmounted directory.
- **Keys:** encrypt with a public key only (`gpg --encrypt --recipient <fingerprint> --trust-model always`), importing the recipient file into a temporary keyring on every run (no persistent keyring). The private key and its passphrase are created and stored by the owner; the assistant never sees them and never runs the key ceremony for the owner. Never print `.env` contents, passphrases or private keys.
- **No plaintext on disk:** all temporary plaintext (dump, `.env` copy, manifest, tar) lives in a `mktemp -d` directory under `$XDG_RUNTIME_DIR` (tmpfs, `/run/user/1000`) with mode 700, removed on exit by a `trap` (also on failure).
- **Only the `kmk` database:** the shared Postgres serves other projects. Scratch databases use the names `kmk_backup_verify` (backup) and `kmk_restore_test` (restore rehearsal) (tests use other suffixes) and are always dropped by a `trap`. No role dump (a server-wide role dump would include other projects' hashes).
- **Script configuration** (environment variables with these defaults; everything is overridable so the tests can run safely): `KMK_BACKUP_DEST=/mnt/shared/BACKUPS/kmk`; `KMK_BACKUP_REQUIRE_MOUNT=/mnt/shared` (empty string disables the check, tests only); `KMK_BACKUP_DB=kmk`; `KMK_BACKUP_SCRATCH_DB=kmk_backup_verify`; `KMK_BACKUP_ENV_FILE=<repo>/deploy/.env`; `KMK_BACKUP_RECIPIENT_FILE=$HOME/.config/kmk-backup/recipient.pub.asc`; `KMK_BACKUP_STATE_DIR=$HOME/.local/state/kmk-backup`; `KMK_BACKUP_PG_CONTAINER=postgres`; `KMK_BACKUP_PG_USER=postgres`; `KMK_BACKUP_KEEP_DAILY=14`; `KMK_BACKUP_KEEP_WEEKLY=8`; `KMK_BACKUP_NOW` (a `date -d` string such as `2026-11-22 02:30:00`, tests only); `KMK_BACKUP_TMP=$XDG_RUNTIME_DIR`. One test-only hook: `KMK_BACKUP_TEST_TRUNCATE_DUMP=1` truncates the dump before verification (proves a damaged dump is caught); it is documented as such and has no other effect.
- **Layout and formats:** archives are `<DEST>/daily/kmk-YYYY-MM-DD_HHMMSS.tar.gpg` and (Sundays) `<DEST>/weekly/<same name>`; each archive is a tar containing `kmk.dump` (`pg_dump -Fc`), `deploy.env` (copy of the env file) and `MANIFEST.txt` with lines `key: value`: `time`, `git_commit`, `alembic_revision`, `db`, `dump_sha256`, and `rows.<table>: <count>` for every table in schema `public`. Written as `*.partial` then renamed. Status file (`key=value` lines): `result=ok|failed`, `time`, `epoch`, `file`, `bytes`, `message`; kept in `$KMK_BACKUP_STATE_DIR/status` always and copied to `<DEST>/STATUS` when the destination is reachable. Exit code `0` on success, `1` on any failure (message on stderr).
- **Retention** is applied only after a new archive has been written successfully: keep the newest `KEEP_DAILY` files in `daily/` and `KEEP_WEEKLY` in `weekly/` (by modification time).
- Scripts: `#!/usr/bin/env bash`, `set -euo pipefail`, mode 755, pass `bash -n`. No `shellcheck` or `bats` is installed; tests are pytest in `backend/tests/test_backup_scripts.py` (skipped when `gpg` or the `postgres` container is unavailable).
- Earlier Global Constraints hold (tests first and watched failing, tests only on `kmk_test`, secrets never in git or logs, commit trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`). The 243 backend and 83 frontend tests stay green.
- **Rulings at plan time:** (1) script tests live in the backend test suite and use the real shared Postgres through `docker exec` with `kmk_test` and scratch databases; (2) the single test-only dump-truncation hook above; (3) the temporary keyring is rebuilt from the recipient file on every run; (4) the independent review needs the owner's go-ahead in chat before a fresh reviewer is launched (a self-review is the labeled fallback); (5) `pip-audit` becomes a development dependency; (6) the key-ceremony script has a test mode (`KMK_KEYGEN_TEST_NOPASS=1`, empty passphrase) used only by its test; (7) database roles are recreated from `deploy/.env` at restore time, not dumped.

## Review Focus

- The backup never writes to the wrong disk or leaves plaintext behind, and refuses to run (writing nothing) without the mount (Task 1).
- A bad dump, a missing key, a stopped database container or a missing destination fails loudly with exit 1 and a recorded failure; retention only runs after a successful write (Task 1).
- Encryption is public-key only; the archive decrypts with the test private key and restores into a scratch database with matching row counts; nothing on this machine can decrypt it (Tasks 1, 2).
- The timer, status check and failure notification work, and a run missed while the computer is off is made up (Task 3).
- The security checklist rows are each backed by evidence actually run, the independent review was done and triaged, and the documentation matches the system (Tasks 6, 7).

---

### Task 1: The backup script

**Files:**
- Create: `deploy/backup/lib.sh`, `deploy/backup/kmk-backup.sh`
- Test: `backend/tests/test_backup_scripts.py` (new)

**Interfaces:**
- Consumes: the shared `postgres` container (`docker exec`), `gpg`, `tar`, `sha256sum`.
- Produces:
  - `lib.sh` (sourced): `log MSG` (stderr), `fail MSG` (stderr, records failed status, `exit 1`), `pg_exec DB SQL...` (runs `psql -U $KMK_BACKUP_PG_USER -d DB -Atc` in the container), `table_counts DB` (prints `table=count` lines for every base table in schema `public`, sorted), `compare_counts DB_A DB_B` (returns `0` when `table_counts` of both are identical, otherwise prints the differing tables and returns `1`), `write_status RESULT MESSAGE [FILE BYTES]`, defaults for all `KMK_BACKUP_*` variables.
  - `kmk-backup.sh`: preflight (mountpoint of `KMK_BACKUP_REQUIRE_MOUNT` unless empty; `docker inspect` says the container is running; recipient file exists and imports into the temporary keyring with exactly one key; env file readable; at least 500 MB free in the destination; destination subfolders created) → dump to the tmpfs work directory → optional test hook → verify (`pg_restore --list`, then drop-create the scratch database, restore through stdin with `--no-owner --no-privileges`, compare `table_counts` of source and scratch, drop scratch) → manifest → tar → encrypt to `daily/*.partial` → rename → Sunday copy to `weekly/` (weekday from `KMK_BACKUP_NOW` or the current time) → retention → success status. A `trap` always removes the work directory, the temporary keyring and the scratch database.

- [ ] **Step 1: Write the tests first** (fixtures: a temporary `GNUPGHOME` with an unprotected test key pair created by `gpg --batch --quick-generate-key`, its public key exported to a temporary recipient file and the private key kept for decryption in the test; a temporary destination; a temporary env file with dummy content; users inserted into `kmk_test` through the existing fixtures; a helper that runs the script with `subprocess.run` and an environment pointing everything at test values: `KMK_BACKUP_DB=kmk_test`, `KMK_BACKUP_SCRATCH_DB=kmk_backup_verify_test`, `KMK_BACKUP_REQUIRE_MOUNT=""`, `KMK_BACKUP_STATE_DIR`, `KMK_BACKUP_TMP`=a temporary directory):
  - `test_run_produces_a_decryptable_archive`: exit `0`; exactly one `daily/*.tar.gpg`; decrypting it with the test private key and un-tarring gives `kmk.dump`, `deploy.env` (identical to the env file) and `MANIFEST.txt`; the manifest has `rows.users` equal to the number of inserted users, the Alembic revision (`0004`), a `dump_sha256` that matches the extracted dump, and a row for every table; the archive file is not readable as plaintext (no `PGDMP` magic bytes, no env content).
  - `test_status_and_cleanliness`: the state directory's `status` has `result=ok`, the file name and size; `<DEST>/STATUS` exists; afterwards the scratch database `kmk_backup_verify_test` does not exist, the temporary directory is empty, and the destination contains only `daily/`, `STATUS` (and no `.partial` files).
  - `test_refuses_without_a_mount`: with `KMK_BACKUP_REQUIRE_MOUNT=/definitely/not/a/mountpoint` the exit code is `1`, stderr names the mount, the destination folder is not created or written, and the status says `failed`.
  - `test_fails_loudly_on_each_missing_prerequisite`: missing recipient file; a recipient file with no valid key; an unreadable env file; `KMK_BACKUP_PG_CONTAINER=no-such-container`; `KMK_BACKUP_DB=no_such_db`: each exits `1`, writes no archive, and records `result=failed` with a message.
  - `test_a_damaged_dump_is_caught`: with `KMK_BACKUP_TEST_TRUNCATE_DUMP=1` the run exits `1`, no archive is written, and the scratch database is cleaned up.
  - `test_row_count_comparison_detects_differences`: source `lib.sh` in a small bash wrapper and call `compare_counts` on `kmk_test` against itself (returns `0`, prints nothing) and against a freshly created empty scratch database (returns `1` and names the differing tables); the test drops that scratch database afterwards.
  - `test_weekly_copy_only_on_sundays`: `KMK_BACKUP_NOW="2026-11-22 02:30:00"` (a Sunday) gives one file in `daily/` and the same name in `weekly/`; `KMK_BACKUP_NOW="2026-11-23 02:30:00"` (a Monday) gives none in `weekly/`; file names carry the date from `KMK_BACKUP_NOW`.
  - `test_retention`: pre-create 20 files in `daily/` and 10 in `weekly/` with increasing modification times; after a run `daily/` holds exactly `KEEP_DAILY` files including the new one (the oldest are gone) and `weekly/` holds `KEEP_WEEKLY`; with the run failing (missing recipient) nothing is deleted.
  - `test_the_script_passes_bash_syntax_check` for every script in `deploy/backup/`.
- [ ] **Step 2: Run to watch them fail** — `cd backend && .venv/bin/pytest tests/test_backup_scripts.py -q` → FAIL (scripts missing).
- [ ] **Step 3: Implement** `lib.sh` and `kmk-backup.sh` to the Interfaces and Global Constraints.
- [ ] **Step 4: Run the whole suite** — `cd backend && .venv/bin/pytest -q` → all pass.
- [ ] **Step 5: Commit** `feat(backup): encrypted, verified database backup script`.

---

### Task 2: Status check, restore rehearsal and key ceremony

**Files:**
- Create: `deploy/backup/kmk-backup-status.sh`, `deploy/backup/kmk-restore.sh`, `deploy/backup/make-backup-key.sh`
- Test: `backend/tests/test_backup_scripts.py` (extend)

**Interfaces:**
- Consumes: Task 1 (`lib.sh`, archive and status formats).
- Produces:
  - `kmk-backup-status.sh [--max-age-hours N]` (default 36): reads `$KMK_BACKUP_STATE_DIR/status`; prints a human summary (result, when, how long ago, file, size); exit `0` only when `result=ok` and the age is within the limit; exit `1` otherwise, including a missing status file.
  - `kmk-restore.sh ARCHIVE --private-key FILE [--extract-only DIR] [--keep-scratch]`: imports the armored private key into a temporary keyring (the passphrase is asked by gpg's own prompt), decrypts to the tmpfs work directory, shows `MANIFEST.txt`, then either extracts the files to `DIR` (mode 600) or restores `kmk.dump` into the scratch database `KMK_RESTORE_DB` (default `kmk_restore_test`), compares `table_counts` with the manifest's `rows.*` lines and prints `RESTORE OK` or the mismatching tables, then drops the scratch database (unless `--keep-scratch`) and removes all temporary plaintext. Exit `0` only on a verified restore.
  - `make-backup-key.sh --private-out FILE [--public-out FILE]`: creates an `ed25519`/`cv25519` key pair in a temporary keyring (the passphrase is asked by gpg unless `KMK_KEYGEN_TEST_NOPASS=1`), writes the armored private key to `FILE` (mode 600, refusing to overwrite), writes the public key to `--public-out` (default `~/.config/kmk-backup/recipient.pub.asc`), prints the fingerprint and reminders (store the private key and passphrase in the password manager, then delete `FILE`), and erases the temporary keyring.

- [ ] **Step 1: Write the tests first:**
  - status: a fresh `ok` status → exit `0` and the summary mentions the file; an old status (epoch older than the limit) → `1`; `result=failed` → `1` and the message is shown; a missing file → `1`; `--max-age-hours` is honored.
  - restore (using an archive produced by the Task 1 helper and its test private key): `--extract-only` writes the three files with mode 600 and nothing else; the default mode prints `RESTORE OK`, exits `0`, and leaves no scratch database or temporary plaintext; a wrong private key (another test key) exits `1` without leaving anything; a tampered archive (one byte changed) exits `1`; a manifest whose counts do not match the restored data (replace `MANIFEST.txt` inside a re-encrypted archive built by the test) exits `1` naming the table; `--keep-scratch` leaves the scratch database (and the test drops it).
  - key ceremony (`KMK_KEYGEN_TEST_NOPASS=1`): creates the private file with mode 600 and the public file; refuses to overwrite an existing private file; the public file imports into a fresh keyring and encrypting then decrypting a sample with the private file round-trips; the temporary keyring is gone; the fingerprint printed matches the public key.
- [ ] **Step 2: Run to watch them fail** — `cd backend && .venv/bin/pytest tests/test_backup_scripts.py -q` → new tests FAIL.
- [ ] **Step 3: Implement** the three scripts.
- [ ] **Step 4: Run the whole suite** → all pass.
- [ ] **Step 5: Commit** `feat(backup): status check, restore rehearsal and key ceremony scripts`.

---

### Task 3: Scheduling and failure notification

**Files:**
- Create: `deploy/backup/systemd/kmk-backup.service`, `deploy/backup/systemd/kmk-backup.timer`, `deploy/backup/systemd/kmk-backup-alert.service`, `deploy/backup/notify-failure.sh`, `deploy/backup/install.sh`
- Test: `backend/tests/test_backup_scripts.py` (extend)

**Interfaces:**
- Consumes: Tasks 1-2.
- Produces:
  - Units with the placeholder `@REPO@` for the repository path: `kmk-backup.service` (`Type=oneshot`, `ExecStart=@REPO@/deploy/backup/kmk-backup.sh`, `OnFailure=kmk-backup-alert.service`); `kmk-backup.timer` (`OnCalendar=*-*-* 02:30:00`, `Persistent=true`, `RandomizedDelaySec=10min`, `WantedBy=timers.target`); `kmk-backup-alert.service` (`Type=oneshot`, runs `notify-failure.sh`).
  - `notify-failure.sh`: reads the state-directory status, sends a critical desktop notification through `notify-send` (with `DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$(id -u)/bus` when unset), always exits `0` (best effort), and logs the message to stderr (so it reaches the journal).
  - `install.sh [--uninstall]`: renders the units with the repository path into `~/.config/systemd/user/`, `systemctl --user daemon-reload`, `enable --now kmk-backup.timer`, prints the next run (`systemctl --user list-timers kmk-backup.timer`) and the key and recipient reminders; `--uninstall` disables and removes them.

- [ ] **Step 1: Write the tests first:** the rendered units pass `systemd-analyze verify` (skip if unavailable) and contain the expected `OnCalendar`, `Persistent=true`, `OnFailure`, and an absolute `ExecStart` path that exists and is executable; `notify-failure.sh` with a fake `notify-send` first in `PATH` records the title and message built from a failed status, exits `0` even when `notify-send` fails or is missing, and never prints secrets; `install.sh` has a `--dry-run` that prints the rendered units and the commands without touching `~/.config` (tested).
- [ ] **Step 2: Run to watch them fail** — `cd backend && .venv/bin/pytest tests/test_backup_scripts.py -q`.
- [ ] **Step 3: Implement** the units and scripts. Do not install the timer yet (that happens in Task 8, after the owner's key exists).
- [ ] **Step 4: Run the whole suite** → all pass.
- [ ] **Step 5: Commit** `feat(backup): systemd timer, failure notification and installer`.

---

### Task 4: Docker log rotation and health checks

**Files:**
- Modify: `deploy/docker-compose.yml`

**Interfaces:**
- Produces: `api` and `caddy` services with `logging: {driver: json-file, options: {max-size: "10m", max-file: "5"}}`; a `healthcheck` on `api` (interval 30 s, timeout 5 s, retries 3, start period 20 s) running `python -c` with the standard library to request `http://127.0.0.1:8001/api/health` and exit non-zero unless the status is 200; a `healthcheck` on `caddy` (same timings) requesting `http://127.0.0.1:8081/` with the header `Host: app.kmk-entretien.ca` through BusyBox `wget`. `caddy` keeps `depends_on: [api]`.

- [ ] **Step 1: Check first (they fail now):** `docker inspect kmk-api --format '{{json .HostConfig.LogConfig}}'` shows no options; `docker inspect kmk-api --format '{{.State.Health}}'` is empty.
- [ ] **Step 2: Edit the compose file;** validate with `cd deploy && docker compose config -q`.
- [ ] **Step 3: Deploy:** `cd deploy && docker compose up -d` (recreates both containers; a few seconds of downtime).
- [ ] **Step 4: Verify:** both containers report `healthy` within about a minute (`docker inspect --format '{{.State.Health.Status}}' kmk-api kmk-caddy`); `LogConfig` shows `max-size 10m` and `max-file 5` for both; the site still answers (`curl -s -H 'Host: app.kmk-entretien.ca' http://127.0.0.1:8081/api/health` and the public URL); to prove the check detects failure, stop nothing in production: instead run the health command by hand against a wrong port and confirm it exits non-zero.
- [ ] **Step 5: Commit** `chore(deploy): log rotation and health checks`.

---

### Task 5: Dependency scanning

**Files:**
- Create: `scripts/audit-deps.sh`
- Modify: `backend/pyproject.toml` (add `pip-audit>=2.7` to the `dev` extra)

**Interfaces:**
- Produces: `scripts/audit-deps.sh`: runs `backend/.venv/bin/pip-audit --skip-editable` (the installed environment) and `npm audit --omit=dev --audit-level=high` in `frontend/`; prints a clear summary per ecosystem; exits `0` only if both are clean at the "high or worse" level and `1` otherwise; never prints secrets; works from any directory.

- [ ] **Step 1: Check first:** `ls scripts/audit-deps.sh` fails now; `backend/.venv/bin/pip-audit` is missing.
- [ ] **Step 2: Add the dev dependency and install it** (run the install in the background; it can take minutes on this host): `cd backend && .venv/bin/pip install -e '.[dev]'`.
- [ ] **Step 3: Write the script;** `bash -n scripts/audit-deps.sh`; extend the syntax-check test in `test_backup_scripts.py` to cover `scripts/*.sh` as well.
- [ ] **Step 4: Run it for real:** `scripts/audit-deps.sh`. For every finding: fix it (upgrade, with the whole test suites passing afterwards) or record it as "not reachable, accepted" with the reason. Keep the output summary for `docs/security.md`.
- [ ] **Step 5: Run the whole suites** (`pytest -q`, `vitest run`, build) → all pass; **commit** `chore: dependency vulnerability scanning`.

---

### Task 6: Security checklist and independent review

**Files:**
- Create: `docs/security-review.md`
- Modify: code and tests only for findings fixed in this task

**Interfaces:**
- Consumes: the live system, the code, `scope.md` §8, `docs/security.md`.
- Produces: `docs/security-review.md` with (a) the checklist and (b) the review record.

- [ ] **Step 1: Walk the checklist with evidence.** For each row run the command (or cite the specific test) and record the result and date in a table (item, how it was checked, result). Rows, at least: HTTPS only (`curl -sI http://app.kmk-entretien.ca/` is a `301` to `https`), HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, the CSP text, no `Server` header; cookie flags (cite `test_cookie_attributes_when_secure`); CSRF (cite `test_mutating_requests_need_origin_and_csrf` and the live no-Origin `403`); real client IP not spoofable (live: a request with `Cf-Connecting-Ip` and a fake `X-Real-Client-Ip` through Caddy records the former, as in earlier phases); generic login and reset answers (live: unknown user `401` body, forgot-password `202`); rate limiting (live: repeated bad logins for a throwaway name give `429`); `/docs` and `/openapi.json` are `404`; the audit role cannot read, update or delete the audit log (`has_table_privilege('kmk_app','audit_log','SELECT'|'UPDATE'|'DELETE')` all false, `INSERT` true); the API container runs as a non-root user; ports `8081`, `8001`, `5432` bound to loopback only (`ss -ltn`); `.env` files are mode 600 and untracked; no secret appears anywhere in git history (scan with the real values from the `.env` files, without printing them); TOTP secrets are encrypted at rest (a database value is a Fernet token); automatic OS updates are active (`systemctl is-enabled apt-daily-upgrade.timer unattended-upgrades`); Docker starts at boot and the containers restart policy is `unless-stopped`; time is synchronized; the dependency scan result (Task 5). Mark anything that cannot be verified from here (for example the Cloudflare dashboard settings) as "owner to confirm" with the exact place to look.
- [ ] **Step 2: Ask the owner for the go-ahead** to launch a fresh independent reviewer (state what it will read and that it runs on the most capable model, and that it only reads). Wait for the answer. If approved, launch it with `subagent_type: general-purpose` and the most capable model, a prompt that names the specs as the requirements and asks for findings graded Critical/Important/Minor with file and line, failure scenario and a suggested fix, covering: `backend/app/` (authentication, sessions, CSRF, rate limiting, MFA, tokens, email, admin policy and lifecycle, CLI), `backend/alembic/versions/`, `frontend/src/` (token and language handling, XSS surfaces, storage use), `deploy/` (Caddyfile, compose, backup scripts: key handling and the wrong-disk guard) and `docs/security.md` against reality. If the owner declines, do a self-review of the same scope and label it as such in the record.
- [ ] **Step 3: Triage.** Re-grade each finding by effect on a real user, not by whether the spec mentions it. Critical and Important: fix each one test-first (a test that reproduces the finding, watch it fail, fix, whole suites green) and record the test name. Minor: record in the review document and in `docs/roadmap.md`. A finding judged not to need a fix is recorded with the reason and the cost if wrong.
- [ ] **Step 4: Write the record** into `docs/security-review.md` (who reviewed, date, scope, findings with their outcome).
- [ ] **Step 5: Run the whole suites and commit** (`pytest -q`, `vitest run`, build; commit the document and fixes separately: `fix(...)` per finding with its test, then `docs: security review`).

---

### Task 7: Go-live documentation and docs update

**Files:**
- Create: `docs/golive.md`
- Modify: `docs/README.md`, `docs/operations.md`, `docs/security.md`, `docs/roadmap.md`, `README.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: everything above and the running system.
- Produces: documentation that matches the system after phase 6.

- [ ] **Step 1: Gather facts** (script names and options with `--help`, the units, the compose file, the audit script output, the review record, test counts).
- [ ] **Step 2: Write `docs/golive.md`:** pre-flight checklist (backup timer enabled and the last backup good; the owner has rehearsed a restore with their private key; the private key and passphrase are in the password manager and a copy of `deploy/.env` exists in the encrypted backups; Resend configured and a deliverability test to Gmail, Outlook and a Canadian provider passed; the super admin enrolled in two-step verification; the decision on `MFA_REQUIRED_ROLES` made before any admin is invited; an uptime monitor pointed at `/api/health`; the Portuguese text reviewed or the risk accepted; Cloudflare settings confirmed: tunnel route and Always Use HTTPS), a pilot (one or two people, what to check, how long), the full invitation (order, how to create accounts, what to tell people, how invitations expire and are re-sent), rollback, and an **incident runbook**: suspected account takeover (disable, reset two-step, reset password, sign-outs, reading the audit log), lost phone, lost backup key or `MFA_ENCRYPTION_KEY`, suspected secret leak (which secrets to rotate and how: `SESSION_SECRET`, database passwords, Resend key), host down or disk full, restoring from backup. Include ready-to-run `psql` queries for the audit log (events for one user, recent failed logins by address, admin actions in the last day, all two-step resets) and **run each query against the database to confirm it works**.
- [ ] **Step 3: Update the other documents:** `docs/operations.md` (replace the backup section: how the job works, the config, the key ceremony, `kmk-backup-status.sh`, `kmk-restore.sh` usage, the step-by-step disaster restore (stop the API, recreate the databases and roles from the `.env` values, restore, start), the known same-disk limit and the future off-site step, log rotation and health checks, the host checklist (boot, clock, updates), `scripts/audit-deps.sh`); `docs/security.md` (backups and their protection, the review and scanning pointers, the HSTS decision); `docs/roadmap.md` (phase 6 done, remaining owner steps, the future items: off-site copy, uptime monitoring, Cloudflare WAF/Access, privacy review before customer data); `docs/README.md` (status table, index entries for `golive.md` and `security-review.md`); `README.md` and `CLAUDE.md` (test counts and a pointer to `deploy/backup/` and `scripts/`).
- [ ] **Step 4: Verify the documents against the system:** every script, option, path, unit name, command and number mentioned exists or matches (run `--help`, `ls`, grep); links and anchors resolve; no secrets (scan with the real values).
- [ ] **Step 5: Commit** `docs: phase 6 go-live runbook and operations`.

---

### Task 8: Install, first real backup and owner handoff

**Files:** none new in the repository (installs into the user's home).

**Interfaces:**
- Consumes: everything above; the owner's public key.
- Produces: the live backup job and a verified first backup; the owner's rehearsal of a restore.

- [ ] **Step 1: Hand the key ceremony to the owner** and stop until it is done. Give the exact command to run themselves with `! ` in the prompt: `/home/evandro/projects/kmk/deploy/backup/make-backup-key.sh --private-out ~/kmk-backup-private-key.asc` (they choose a passphrase, copy the printed private key and passphrase into the password manager, then delete the file). Tell them what to report back: only that it succeeded (never the private key or passphrase). Confirm `~/.config/kmk-backup/recipient.pub.asc` exists and shows one public key (`gpg --show-keys` on it); never ask for the private key.
- [ ] **Step 2: Install and run once:** `deploy/backup/install.sh`, then `systemctl --user start kmk-backup.service` and wait for it; `kmk-backup-status.sh` exits `0`; the archive exists under `/mnt/shared/BACKUPS/kmk/daily/`, its size is plausible, it starts with the PGP encrypted-data marker and cannot be listed without the private key (`gpg --list-packets` shows only the recipient key id); no plaintext (no `PGDMP`, no env content) appears in the destination; the scratch database is gone; the timer shows its next run (`systemctl --user list-timers kmk-backup.timer`); the journal for the run shows no errors.
- [ ] **Step 3: Prove the guards on the real machine without breaking anything:** run the script with `KMK_BACKUP_REQUIRE_MOUNT=/definitely/not/a/mountpoint` and confirm it exits `1` and writes nothing new; run `notify-failure.sh` once with a failed sample status and ask the owner whether the desktop notification appeared.
- [ ] **Step 4: Hand off the owner's rehearsal:** the owner restores the newest archive into the scratch database with their private key: `deploy/backup/kmk-restore.sh <newest archive> --private-key <the key file they restore from their password manager>`; expected: `RESTORE OK`; then they delete the key file. Offer to stay for it. Then walk through `docs/golive.md` with them, item by item, marking what is done and what remains (Resend, two-step enrollment, enforcement choice, uptime monitor, pilot).
- [ ] **Step 5: Commit** only if tracked files changed (for example docs corrected during the walk-through); otherwise nothing to commit.
