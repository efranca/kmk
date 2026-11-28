# Go-live runbook

How to go from "built" to "the whole team is using it", and what to do when something goes wrong.
Commands run on the server (this computer) unless stated. `deploy/` and `scripts/` are in the repository root (`/home/evandro/projects/kmk`).
Background: [operations.md](operations.md) (running the system), [security.md](security.md) (the model), [security-review.md](security-review.md) (what was checked).

## 1. Pre-flight: before anyone is invited

| # | Check | How to check | Done when |
| --- | --- | --- | --- |
| 1 | Backups work | `deploy/backup/kmk-backup-status.sh` and `systemctl --user list-timers kmk-backup.timer` | status says OK and the timer has a next run |
| 2 | The backups are where you expect | `ls infrastructure/backups/daily` shows recent `kmk-*.tar` files (the newest 14 are kept) | the newest file is less than a day old |
| 3 | A restore has been rehearsed | `deploy/backup/kmk-restore.sh <newest archive>` | it prints `RESTORE OK` |
| 4 | Real email is on | `EMAIL_BACKEND=resend` and `RESEND_API_KEY` set in `deploy/.env`; domain verified in Resend; a test invite reaches Gmail, Outlook and a Canadian provider (not spam) | no `DEV EMAIL` lines appear in `docker logs kmk-api` for new messages |
| 5 | Your own account has two-step verification | sign in, open "My account", enable it, save the recovery codes | the page shows "Two-step verification: on" |
| 6 | Decide about forcing two-step | set `MFA_REQUIRED_ROLES=admin,superadmin` in `deploy/.env` **before** inviting any admin (see operations.md) | the choice is made and written down |
| 7 | Secrets are backed up | `MFA_ENCRYPTION_KEY` (and the database passwords) copied to your password manager; **`deploy/.env` is not in the backups**, so this copy is the only one | you can find them without this computer |
| 8 | Someone is told when it is down (optional, recommended) | an uptime monitor on `https://app.kmk-entretien.ca/api/health` expecting `200` and `{"status":"ok"}` | you receive its test alert |
| 9 | Code is healthy | `cd backend && .venv/bin/pytest -q`, `cd frontend && npx vitest run`, `scripts/audit-deps.sh` | all pass, scan clean |
| 10 | Containers are healthy | `docker inspect --format '{{.Name}} {{.State.Health.Status}}' kmk-api kmk-caddy` | both `healthy` |
| 11 | Portuguese text | reviewed by someone who reads Portuguese, or you accept the risk | decided |
| 12 | Home page | the Dashboard ("My events", "All events") replaced the placeholder Welcome page; check that colleagues do not put anything in event titles or notes that other employees should not read (everyone sees every event) | decided |
| 13 | Cloudflare | route `app` → `http://localhost:8081` exists; "Always Use HTTPS" on (`curl -sI http://app.kmk-entretien.ca/` shows a `301`) | confirmed |
| 14 | A reboot is survivable (optional) | reboot the computer, then `docker compose -f deploy/docker-compose.yml ps` and `systemctl --user list-timers kmk-backup.timer` | everything came back by itself |
| 15 | Visits: the photo folder is ready | `ls -ld deploy/data/visit-photos` shows owner `10001`, your group, `drwxr-s---` (steps in operations.md, "Visit photos"); `docker compose restart caddy` was run after the Caddyfile change | done before the first deploy of the visits module |
| 16 | Visits: both timers are installed | `systemctl --user list-timers kmk-backup.timer kmk-visit-photos-purge.timer` | both have a next run (backup about 02:30, purge 03:15) |
| 17 | Visits: photos are in the backup and a restore was rehearsed | `ls infrastructure/backups/photos` shows a snapshot; `deploy/backup/kmk-backup-status.sh` says `photos: N files`; the photo copy-back was tried into a scratch folder | a snapshot exists and its file count matches the folder |
| 18 | Visits: a real test visit | on a real iPhone and Android phone: check in with a colleague, a portrait photo (upright?), a bad-signal upload, check-out, a correction, then the report and its CSV as an admin | everything worked and photos look right |

## 2. Pilot

Invite **one or two people first** (ideally one of them a Portuguese speaker), from the admin page (Users → Invite).
Watch for: the invitation email arrives (and where: inbox or spam); the link opens the set-password page in the right language; setting a password works; signing in works; the language switcher sticks;
two-step verification can be enabled; they appear in your user list with a sign-in date. After two or three days read the audit log (queries in section 5) for anything odd, and ask them what was confusing.
Fix what you learn, then continue.

## 3. Invite everyone

1. Use the admin page: one invitation per person: their **name** (as they want to be addressed: it appears in the greeting and in the user list), username (lowercase, 3-32 characters of `a-z 0-9 . _ -`), their email address, and **their language** (it decides the language of the email and of their first page).
2. Invitations are valid for 48 hours and work once. If one expires, open the person's row and use "Resend invitation". If you correct a mistyped email address on a person who has not accepted yet, the first link stops working at once: press "Resend invitation" so the corrected address gets a new one. A forgotten password is recovered with the "Mot de passe oublié ?" link.
3. Tell people what to expect, for example: "You will receive an email from KMK Entretien. Click the link within 2 days, choose a password (at least 8 characters with letters, digits and a special character), then sign in at https://app.kmk-entretien.ca. We recommend turning on two-step verification under 'My account'."
4. Only the super admin can create admins. If you do, enroll them in two-step verification first (section 1, check 6).

## 4. Routine after go-live

| When | What |
| --- | --- |
| Weekly | `deploy/backup/kmk-backup-status.sh` (should say OK, newer than 36 hours); glance at the open sessions and failed-login queries below |
| Monthly | free disk space (`df -h /`; photos and their snapshots grow with use, uploads stop under 1 GiB free); `docker ps` health; `docker logs kmk-api` for errors |
| Before every deploy | `scripts/audit-deps.sh`; both test suites |
| Every three months | rehearse a restore (check 3, and the photo copy-back, check 17); check the password manager still has the `deploy/.env` secrets |
| When people leave | disable the account on the admin page (this signs them out at once); delete it later if you wish |

## 5. Reading the audit log

The application cannot read the audit log (by design); you read it as the database superuser:
`docker exec -i postgres psql -U postgres -d kmk` (then paste a query), or one-off: `docker exec -i postgres psql -U postgres -d kmk -c "<query>"`. These queries were run against the live database when this document was written.

```sql
-- Everything done by or to one person (change the username)
select u.name as person, a.id, a.timestamp, a.action, a.ip, a.details
from audit_log a join users u on u.username = 'NAME'
where a.actor_user_id = u.id or a.target_user_id = u.id
order by a.id desc limit 50;

-- Failed sign-ins by address, last 24 hours
select ip, count(*) as failures, min(timestamp) as first, max(timestamp) as last
from audit_log where action in ('login_failed','login_rate_limited') and timestamp > now() - interval '24 hours'
group by ip order by failures desc limit 20;

-- Admin actions, last day
select a.timestamp, adm.username as actor, adm.name as actor_name, a.action, t.username as target, t.name as target_name, a.details
from audit_log a left join users adm on adm.id = a.actor_user_id left join users t on t.id = a.target_user_id
where a.timestamp > now() - interval '1 day'
  and a.action in ('user_invited','invite_resent','user_disabled','user_enabled','user_deleted','user_restored','user_role_changed','user_updated','mfa_reset')
order by a.id desc;

-- Every reset of two-step verification
select a.timestamp, adm.username as actor, adm.name as actor_name, t.username as target, t.name as target_name, a.details
from audit_log a left join users adm on adm.id = a.actor_user_id left join users t on t.id = a.target_user_id
where a.action = 'mfa_reset' order by a.id desc;

-- Recent successful sign-ins
select a.timestamp, u.username, u.name, a.ip from audit_log a join users u on u.id = a.actor_user_id
where a.action = 'login_success' order by a.id desc limit 20;

-- Who is signed in right now (open, unexpired sessions)
select u.username, u.name, s.created_at, s.expires_at, s.ip, left(s.user_agent, 60) as browser
from sessions s join users u on u.id = s.user_id
where s.revoked_at is null and s.expires_at > now() order by s.created_at desc;
```

Emergency changes (run only when you mean it; prefer the admin page when it is available):

```sql
-- Sign one person out everywhere
update sessions set revoked_at = now()
where user_id = (select id from users where username = 'NAME') and revoked_at is null;

-- Sign EVERYONE out
update sessions set revoked_at = now() where revoked_at is null;
```

## 6. Incident runbook

| Situation | What to do |
| --- | --- |
| **An account may be taken over** (strange sign-in, an employee reports it) | Follow this order, so the attacker is never let back in: 1. Admin page: **Disable** the account (signs every session out at once; the stolen password stops working). 2. If they use two-step verification and the phone may be compromised: **Reset 2FA**. 3. **Reset password** (allowed while the account is disabled): the real person gets an email link and sets a **new** password; the account stays disabled while they do. 4. Ask them to confirm they have set it, and only then **Enable** the account. 5. Read the audit log for that person (query 1) and for the addresses involved (query 2) to see what was done. 6. If it was an admin account, also review "Admin actions" (query 3). |
| **The super admin account may be compromised** | Sign everyone out (emergency query above). On the server: `cd deploy && docker compose exec api python -m app.cli reset-mfa --username <name>`; reset the password through "forgot password" (the link goes to the email on file), change `SESSION_SECRET` (below), and read the audit log. |
| **Someone lost their phone** | Admin page: **Reset 2FA** for them (or, for the super admin, the server command above). They sign in with their password and enroll again. If they still have recovery codes they can use one at the sign-in screen. |
| **You lost your phone and recovery codes** (super admin) | On the server: `cd deploy && docker compose exec api python -m app.cli reset-mfa --username <name>`, then sign in with the password and enroll again. |
| **A secret may have leaked** | Rotate it: `SESSION_SECRET`: edit `deploy/.env`, `cd deploy && docker compose up -d` (open pages must be reloaded; also sign everyone out if sessions may be stolen). Database passwords: `docker exec -i postgres psql -U postgres -d postgres -c "ALTER ROLE kmk_app PASSWORD '<new>'"` (and `kmk` for migrations), update `DATABASE_URL` / `MIGRATION_DATABASE_URL` in `deploy/.env` and `backend/.env`, `docker compose up -d`. Resend key: create a new one in the dashboard, update `deploy/.env`, `docker compose up -d`, delete the old one. `MFA_ENCRYPTION_KEY`: there is no rotation yet: a new key makes every stored TOTP secret unreadable, so everyone with two-step verification needs a 2FA reset and re-enrollment (use only if the key and a database copy may both have leaked). Update your password-manager copy of `.env` afterwards (the backups do not contain it). |
| **The backup folder may have been copied or read by someone else** | The backups are not encrypted: they hold employee names and emails and password hashes (not `.env`). Treat it like a database leak: rotate the secrets in `.env` (row above) and consider asking everyone to change their password. |
| **The site is down** | After any change to `deploy/docker-compose.yml`, check `docker compose ps` first: a container that restarts with `operation not permitted` lost a capability it needs (see operations.md, Troubleshooting). Otherwise: `docker compose -f deploy/docker-compose.yml ps`; `docker logs kmk-api --tail 50`; `docker logs kmk-caddy --tail 50`; `curl -s -H 'Host: app.kmk-entretien.ca' http://127.0.0.1:8081/api/health`; if the containers are fine, check the tunnel container `famillai-cloudflared` and Cloudflare's status. Restart with `cd deploy && docker compose up -d`. |
| **The disk is full** | `df -h /`; `docker system df`; container logs are capped (5 files of 10 MB each); old backups are pruned automatically (the newest 14). Free space, then run `deploy/backup/kmk-backup-status.sh`. |
| **The database is lost or damaged** | Restore from the newest good backup (step-by-step procedure in operations.md, "Restoring after a disaster"). Everything since the last backup (up to 24 hours) is lost; people may need new sign-in sessions. |
| **You need to take the site offline** | `cd deploy && docker compose stop caddy` (visitors see an error page); `docker compose start caddy` to bring it back. |
