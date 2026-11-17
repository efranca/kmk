# Phase 6 (Hardening and go-live): backups, review, operations, go-live checklist

Builds on `scope.md` (§8 security checklist, §11 phase 6, §12 accepted risks), `docs/roadmap.md` and `docs/security.md`. Where this differs from `scope.md`, this document wins.

## Intent
Make the system safe to hand to the ~15 employees: the data can be restored (it cannot be today: there are no backups), the code and configuration have had an independent look, the stack survives reboots and does not fill the disk,
and there is one checklist that takes the owner from "built" to "everyone invited", with an incident runbook for when something goes wrong.

## Goals
- **Encrypted, automated, verified backups** of the `kmk` database and `deploy/.env`, written to `/mnt/shared/BACKUPS/kmk` (the owner's choice), with retention, daily self-verification, failure alerts, and a documented and rehearsed restore.
- Operational hardening: Docker log rotation for the two kmk containers, a container health check, host checklist (boot, clock, updates) verified and written down.
- Dependency vulnerability scanning for Python and JavaScript behind one command, with findings triaged.
- A security review: a walk through the `scope.md` §8 checklist with evidence, plus an independent fresh-context review of the code; Critical and Important findings fixed with tests, the rest recorded.
- `docs/golive.md`: pre-flight checks, a pilot, the invitation of everyone, and rollback; and an incident runbook (compromised account, lost phone, lost key, suspected leak).
- Documentation updated.

## Non-goals
An off-site copy (known limit, see below), a monitoring service sign-up (recommended, owner's step), Cloudflare WAF or Access, host firewall changes, changes to other projects' services on this machine, an audit-log viewer,
a third-party penetration test, the privacy-law review (still a gate before customer records, not before employee accounts), changing the password policy (kept at 8 characters with a mix for v1, as accepted in `scope.md`).

## Anti-goals
A backup that silently goes to the wrong disk; a backup that has never been restored; plaintext employee data or secrets on the shared partition; a key on this machine that can decrypt the backups; a failure nobody notices; a review that only the author performed; documentation that describes intentions instead of what was verified.

## Constraints
- `/mnt/shared` is an NTFS partition (`nvme0n1p4`) on the **same SSD** as the system (`nvme0n1p6`), mounted with `nofail`, readable from Windows, with permissions not enforced. So: backups must be encrypted, and the script must refuse to run unless `/mnt/shared` is really mounted (otherwise it would write onto the system disk).
- **Known limit (accepted by the owner for now):** same physical disk. The backups survive mistakes, a Linux reinstall and filesystem damage, but not an SSD failure, theft or fire. An external or cloud copy is recorded as a future step.
- `age` is not installed; `gpg` 2.4 is. User-level systemd timers work without a login (`Linger=yes`); Docker starts at boot; the clock is synced; Ubuntu security updates are scheduled. Timezone `America/Toronto`.
- The shared Postgres belongs to several projects: the backup touches only the `kmk` database and uses a temporary scratch database name for verification. The shared `pg-backup.sh` is not used (it needs a `.env` that does not exist here).
- The assistant never sees the backup private key or its passphrase, and never handles the owner's passwords.

## Approaches considered (my calls unless noted)
- **Backup destination:** same disk folder, external drive, cloud. **User: `/mnt/shared/BACKUPS/kmk`, encrypted.**
- **How backups are encrypted:** a passphrase on this machine (so the job can run unattended, but then it can also read the backups), vs public-key encryption. **Pick: public-key (`gpg`).** The job holds only the public key; the private key lives in the owner's password manager and is needed only to restore.
- **Scheduling:** cron vs a systemd user timer. **Pick: a user timer** (`Persistent=true` so a missed 02:30 runs at the next start; works without login thanks to linger; logs in the journal).
- **Knowing a backup is good:** trust the dump vs verify it. **Pick: verify daily**: every run restores the dump into a scratch database and compares row counts with the source, then drops it. The full decrypt path (private key) is rehearsed by the owner, and documented.
- **What goes in the archive:** database dump plus `deploy/.env` (it holds the keys that the database does not: `MFA_ENCRYPTION_KEY`, `SESSION_SECRET`, database passwords) plus a manifest. Database roles are not dumped (a server-wide role dump would include other projects' hashes); the restore recreates `kmk` and `kmk_app` from the `.env`.
- **Failure alerts:** email vs desktop notification vs status file. **Pick: a status file always, plus a desktop notification when a run fails** (best effort), plus a one-command status check. Email through the app waits until Resend is configured.
- **Independent review:** self-review only vs a fresh-context reviewer. **Pick: a fresh reviewer** (the owner's go-ahead is needed to launch one, or the owner runs `/code-review`); a self-review is the fallback and is labeled as such.
- **HSTS preload:** **No.** It would pin every subdomain of `kmk-entretien.ca` (including the public site) to HTTPS-only and is hard to undo; the current one-year HSTS header is kept.

## Decisions
**Backup job** (`deploy/backup/`, installed by `install.sh` into `~/.config/systemd/user/`; config in `~/.config/kmk-backup/`):
1. Preflight, failing loudly with a clear message: `/mnt/shared` is a mountpoint; the `postgres` container is running; the recipient public key is present; enough free space.
2. Dump the `kmk` database (`pg_dump -Fc` through `docker exec`) into a temporary directory on tmpfs (`$XDG_RUNTIME_DIR`), so plaintext never touches a disk.
3. Verify: `pg_restore --list`, then restore into a scratch database, compare the row count of every table with the source, drop the scratch database.
4. Write a manifest (time, git commit, Alembic revision, per-table row counts, dump checksum), tar it with the dump and a copy of `deploy/.env`, encrypt to the recipient, write as `.partial` then rename into `daily/kmk-YYYY-MM-DD_HHMMSS.tar.gpg`.
5. On Sundays also copy into `weekly/`. Retention: newest 14 daily and 8 weekly files are kept.
6. Record the outcome in a status file (kept in `~/.local/state/kmk-backup/` and copied next to the backups when reachable). A failing run exits non-zero; the failure hook sends a desktop notification.
7. Timer: daily at 02:30 with `Persistent=true` and a small random delay.
- **Key ceremony (owner's step, the assistant never sees the secret):** a helper script generates a key pair in a temporary keyring, shows the private key for the owner to store in the password manager (protected by a passphrase they choose), exports only the public key to `~/.config/kmk-backup/`, and erases the temporary keyring.
- **Status check:** `kmk-backup-status.sh` prints the last result and its age and exits non-zero if the last good backup is older than 36 hours.
- **Restore:** `kmk-restore.sh` decrypts an archive (the owner supplies the private key through a temporary keyring), prints the manifest, and by default restores into a scratch database `kmk_restore_test` and compares counts; it can also just extract. The live-disaster procedure (stop the API, recreate the database and roles, restore, start) is documented step by step in `docs/operations.md` and rehearsed against the scratch database.

**Operational hardening:**
- `deploy/docker-compose.yml`: `logging` with `max-size: 10m`, `max-file: "5"` on `api` and `caddy`; a `healthcheck` on `api` (the health endpoint through Python's standard library, no curl needed). Caddy `depends_on` stays.
- Host checklist verified and documented (not changed): Docker enabled at boot, containers `restart: unless-stopped`, time sync, automatic security updates. A reboot rehearsal is offered to the owner, not forced.

**Dependency scanning:** `scripts/audit-deps.sh` runs `pip-audit` (a development dependency, run against the installed environment) and `npm audit --omit=dev`; exits non-zero on findings of high severity or worse; results triaged into "fixed", "not reachable, accepted" with a reason, in `docs/security.md`.

**Security review:**
- `docs/security-review.md`: the `scope.md` §8 checklist item by item with the command or test that proves it (headers, cookie flags, CSRF, rate limits, generic errors, audit log, secrets handling, CSP, tokens, MFA), run against the live system where possible, with the date and result of each.
- The independent review reads the backend, frontend and deploy files with the design documents as the specification; findings are graded by effect, Critical and Important are fixed (test first) in this phase, minors are recorded in the roadmap.

**Go-live and incidents (`docs/golive.md`):** pre-flight (backup verified and restore rehearsed by the owner; Resend configured and deliverability tested; the super admin enrolled in two-step verification; the decision on `MFA_REQUIRED_ROLES` before inviting any admin; uptime monitor set up; the Portuguese text reviewed if possible); a pilot with one or two people; the full invitation order; what to tell employees; rollback.
Incident runbook: a suspected account takeover (disable, reset two-step, reset password, review the audit log with `psql` queries provided), a lost phone, a lost `MFA_ENCRYPTION_KEY` or backup key, a suspected secret leak (rotate `SESSION_SECRET`, database passwords, Resend key), the host being down.

## Owner's steps (the assistant guides, the owner does)
Run the key ceremony and store the private key and its passphrase in the password manager; rehearse a restore with the private key; set up Resend; enroll two-step verification on the super admin account; choose the enforcement setting; sign up for an uptime monitor (optional); approve launching the independent reviewer.

## Verification the plan must cover
- Backup script tests (against `kmk_test` and a temporary destination and test key): a run produces an encrypted archive that decrypts with the test private key and contains the dump, `.env` copy and manifest; manifest counts match the source; the scratch database is gone afterwards; no plaintext is left in the destination or temporary directory; the run fails loudly and writes nothing when the destination is not a mountpoint, when the recipient key is missing, or when the database container is not running; retention keeps exactly 14 daily and 8 weekly files; the weekly copy happens on a Sunday; a corrupted dump is detected by the verification.
- A real run on this machine, a restore into the scratch database using the owner's private key, and the status script; the timer is enabled and shows its next run.
- Compose changes validated; the container reports healthy; a log-rotation check (`docker inspect` shows the options).
- `audit-deps.sh` runs and its result is recorded.
- The security checklist document: every row has evidence that was actually run; the independent review is done and triaged; fixes have tests.
- Documentation accuracy (every command, path and number checked against the system).

## Left to the builder
Script structure and naming, the exact manifest format, how the tests fake the mount check, wording of the status messages, the layout of the go-live and security-review documents (within the contents above).
