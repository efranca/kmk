# Documentation index

What this is: the internal app for KMK Entretien Ménager at https://app.kmk-entretien.ca. These documents describe the system
**as built**. The original plan is [../scope.md](../scope.md); where the two differ, `docs/` is right.

| Document | Contents |
| --- | --- |
| [operations.md](operations.md) | Runbook: deploy, settings, database, CLI, backups, email, MFA switch, troubleshooting |
| [decisions.md](decisions.md) | The decision log: what was decided, why, what was rejected, when to revisit |
| [security.md](security.md) | The security model as implemented, accepted risks, what is not covered |
| [security-review.md](security-review.md) | The checklist with live evidence and the independent review (findings and what was fixed) |
| [golive.md](golive.md) | Pre-flight checklist, pilot, inviting everyone, routine, incident runbook, audit-log queries |
| [roadmap.md](roadmap.md) | What is next, deferred items, parked risks, open questions |
| [superpowers/specs/](superpowers/specs/) | Design documents, one per phase (the reasoning and the decisions) |
| [superpowers/plans/](superpowers/plans/) | Implementation plans, one per phase (the task lists that were executed) |

## How a request travels

```
browser --HTTPS--> Cloudflare --tunnel (outbound from this machine)--> cloudflared (famillai-cloudflared container)
   --> http://localhost:8081  Caddy (kmk-caddy): serves frontend/dist, proxies /api/* ---> http://127.0.0.1:8001  API (kmk-api, FastAPI)
                                                                                    ---> 127.0.0.1:5432  PostgreSQL (shared container, database "kmk")
```

- Cloudflare terminates HTTPS and redirects `http://` to `https://` ("Always Use HTTPS"). The hops after the tunnel are plain HTTP on loopback.
- The home connection has no public IP (CGNAT), so nothing is exposed except through the tunnel. The tunnel container belongs to the famillai project and is shared.
- Caddy resolves the real visitor address from Cloudflare's `Cf-Connecting-Ip` header and passes it to the API as `X-Real-Client-Ip` (overwriting anything the browser sent).

## Status

| Phase | Content | State | Design | Plan |
| --- | --- | --- | --- | --- |
| Placeholder | "Under Construction" page behind the tunnel | done, replaced | [spec](superpowers/specs/2026-11-17-app-kmk-ca-placeholder-design.md) | [plan](superpowers/plans/2026-11-17-app-kmk-placeholder.md) |
| 1 Foundation | repo, API health check, Alembic, React shell, Caddy wiring | done | [spec](superpowers/specs/2026-11-17-kmk-app-design.md) | [plan](superpowers/plans/2026-11-17-kmk-phase1-foundation.md) |
| 2 Core auth | users, sessions, login/logout, rate limiting, audit log, minimal login page | done | [spec](superpowers/specs/2026-11-17-phase2-core-auth-design.md) | [plan](superpowers/plans/2026-11-17-kmk-phase2-core-auth.md) |
| 3 Account flows | invite, password reset, password change, email layer (Resend or log) | done (email still in `log` mode) | [spec](superpowers/specs/2026-11-17-phase3-account-flows-design.md) | [plan](superpowers/plans/2026-11-17-kmk-phase3-account-flows.md) |
| 4a TOTP | optional two-step verification, recovery codes, enforcement switch (off) | done | [spec](superpowers/specs/2026-11-17-phase4a-totp-design.md) | [plan](superpowers/plans/2026-11-17-kmk-phase4a-totp.md) |
| 4b Admin | admin page, user lifecycle, authority rules (only the super admin manages admins) | done | [spec](superpowers/specs/2026-11-17-phase4b-admin-design.md) | [plan](superpowers/plans/2026-11-17-kmk-phase4b-admin.md) |
| 5 Frontend | app shell, welcome page (placeholder, since replaced by the Dashboard), per-user language switching, polish | done | [spec](superpowers/specs/2026-11-17-phase5-frontend-design.md) | [plan](superpowers/plans/2026-11-17-kmk-phase5-frontend.md) |
| 7 Schedule and Dashboard | shared calendar (Day, Week, Month, Year, repeating events, reminders, drag to move) and the Dashboard home page with the "My events" and "All events" widgets, in a FamillAI-style layout | done | [spec](superpowers/specs/2026-11-24-schedule-dashboard-design.md) | [plan](superpowers/plans/2026-11-24-schedule-dashboard.md) |
| 8 Tasks | the team's to-do list: tasks for people or the whole team with a due date, categories with icons, status tabs (To do, In progress, Done), a List/Board view menu (the board moves cards by drag and drop or a "Move to" control), people filter, search, "Clear completed"; a "My tasks" Dashboard card; an optional "Show tasks" switch on the Schedule. No repeating tasks, rewards or AI | done | [spec](superpowers/specs/2026-11-24-tasks-design.md) | [plan](superpowers/plans/2026-11-24-tasks.md) |
| 6 Hardening | encrypted verified backups, container limits and health checks, dependency scan, independent security review, go-live runbook | built; go-live waits for the owner's steps (key, Resend, two-step, pilot) | [spec](superpowers/specs/2026-11-17-phase6-hardening-design.md) | [plan](superpowers/plans/2026-11-17-kmk-phase6-hardening.md) |

## Data model (as built)

Tables, all created by the migrations in `backend/alembic/versions/`:

| Table | Purpose | Key columns |
| --- | --- | --- |
| `users` | accounts | `username`, `name` (the person's display name, 1-100 characters, optional in the database for accounts that predate it), `email` (both lowercase, unique), `password_hash` (Argon2id, null until an invite is accepted), `role` (`user`/`admin`/`superadmin`; one super admin allowed), `locale` (`fr-CA`/`en`/`pt-BR`), `status` (`invited`/`active`/`disabled`/`deleted`), `mfa_enabled`, `mfa_secret` (Fernet-encrypted), `mfa_last_step`, `preferences` (JSON: theme, sidebar, tasks view, Schedule tasks switch, Dashboard widgets), `avatar_updated_at` (NULL = no picture) |
| `sessions` | server-side sessions | `token_hash` (primary key), `user_id`, `expires_at` (5 days), `revoked_at`, `ip`, `user_agent`, `mfa_verified` |
| `tokens` | invite and reset links | `token_hash`, `user_id`, `purpose` (`invite`/`reset`), `expires_at`, `used_at` |
| `recovery_codes` | TOTP recovery codes | `user_id`, `code_hash` (unique), `used_at` |
| `login_attempts` | rate-limit bookkeeping | `ip`, `identifier`, `success`, `kind` (`login`/`reset_request`/`token`/`mfa`), `at` |
| `audit_log` | append-only security events | `timestamp`, `actor_user_id`, `action`, `target_user_id`, `ip`, `details` (JSON) |
| `events` | one event or repeating series (wall-clock values in the company time zone, `America/Toronto`) | `title`, `notes`, `icon`, `color` (one of 8), `all_day`, `start_date`, `start_time`, `duration_minutes`, `recurrence` (JSON rule, null = does not repeat), `ends_on` or `max_count` (never both), `created_by`, `updated_by` |
| `event_people` | who an event is for (no rows = everyone) | `event_id`, `user_id` |
| `event_exceptions` | "this occurrence only" changes of a repeating event | `event_id`, `original_date`, `cancelled`, overrides of title, notes, date, time, length |
| `event_reminders` | up to 10 per event ("2 hours before") | `event_id`, `amount` (1-99), `unit` (`hours`/`days`/`weeks`) |
| `reminder_dismissals` | a person dismissed the reminder of one occurrence | `user_id`, `event_id`, `occurrence_date` |
| `task_categories` | the labels of tasks | `name` (1-50, unique ignoring case), `icon` (one emoji, optional), `created_by` (NULL for the ten starter categories the migration adds) |
| `tasks` | one task, to do or completed | `title`, `description`, `icon`, `category_id` (set null when the category is deleted), `status` (`pending`/`in_progress`/`completed`), `due_date` (a date in the company time zone, optional), `completed_at` and `completed_by` (set exactly when completed), `show_on_dashboard`, `created_by`, `updated_by` |
| `task_people` | who a task is for (no rows = the whole team) | `task_id`, `user_id` |
| `user_avatars` | a person's profile picture, at most 50 KB (JPEG, PNG or WebP); `users.avatar_updated_at` says whether there is one | `user_id`, `content_type`, `data`, `updated_at` |
| `alembic_version` | migration state | |

Deletion is soft (`status = 'deleted'`, `deleted_at` set): the row stays, so the audit log keeps its references and the username and email stay reserved. An admin can restore a deleted account (it comes back `disabled`).

## API

All routes are under `/api`. "Verified" means a signed-in session whose two-step state is `ok` (see [security.md](security.md)).
Every mutating request needs an allowed `Origin` header; authenticated mutating requests also need the `X-CSRF-Token` header.

| Method and path | Who | Purpose |
| --- | --- | --- |
| `GET /api/health` | anyone | liveness and database check |
| `POST /api/auth/login` | anyone | username-or-email and password; returns the user (including `name`), a CSRF token, and the two-step state |
| `GET /api/auth/me` | any session state | current user, CSRF token, `mfa` state (`ok`/`verify`/`setup`), `mfa_enabled` |
| `POST /api/auth/logout` | any session state | revoke the session |
| `POST /api/auth/forgot-password` | anyone | request a reset email (always answers the same) |
| `POST /api/auth/set-password` | anyone with a token | accept an invite or finish a reset |
| `POST /api/auth/change-password` | verified | needs the current password |
| `POST /api/auth/locale` | verified | set your own interface and email language (`fr-CA`, `en`, `pt-BR`) |
| `POST /api/auth/mfa/setup` | verified or `setup` state | start enrollment, returns the secret and `otpauth://` URI |
| `POST /api/auth/mfa/enable` | verified or `setup` state | confirm a code, returns the 10 recovery codes once |
| `POST /api/auth/mfa/verify` | `verify` state | second login step: a code or a recovery code |
| `POST /api/auth/mfa/disable` | verified | needs password and a code; refused for roles in `MFA_REQUIRED_ROLES` |
| `POST /api/auth/mfa/recovery-codes/regenerate` | verified | needs password and a code |
| `PUT /api/me/avatar`, `DELETE /api/me/avatar` | verified | set (raw JPEG, PNG or WebP body, at most 50 KB, `422 invalid_image` otherwise) or remove your own picture |
| `DELETE /api/admin/users/{id}/avatar` | verified admin or super admin, with the same authority as editing that person | take down someone's picture (nobody can put one up for someone else) |
| `GET /api/people/{id}/avatar` | verified | the picture (with `ETag`); `404` when there is none. Every user payload and the people list carry `avatar_url` |
| `PATCH /api/me/preferences` | verified | change preferences (see Settings and preferences) |
| `GET /api/admin/users` | verified admin or super admin | all accounts with role, status, two-step state, last sign-in, and the `actions` the caller may take on each row |
| `POST /api/admin/users` | verified admin or super admin | create and invite an account: a **name** is required; role `user`, or `admin` for the super admin only |
| `PATCH /api/admin/users/{id}` | verified admin or super admin (per [authority](security.md#administration-authority-and-account-lifecycle)) | change name or language; change email only while the account is `invited` (the super admin may also edit their own account) |
| `POST /api/admin/users/{id}/invite` | as above | re-send an invite |
| `POST /api/admin/users/{id}/reset` | as above | email a reset link (admins and the super admin may also do it for themselves) |
| `POST /api/admin/users/{id}/reset-mfa` | as above | remove the target's two-step verification and sign them out |
| `POST /api/admin/users/{id}/disable`, `/enable`, `/delete`, `/restore` | as above | account lifecycle (see the state machine in [security.md](security.md)) |
| `POST /api/admin/users/{id}/role` | super admin only | switch an account between `user` and `admin` |
| `GET /api/schedule/events?from&to&q&people` | verified | the occurrences in a range (at most 400 days; repeating events are expanded when read), with a keyword search (2+ letters, accents ignored) and a people filter; everyone sees every event in full |
| `GET /api/schedule/events/{id}` | verified | one event: its rule, people, reminders and one-off changes |
| `POST /api/schedule/events` | verified | create an event for yourself, anyone, or everyone; a repeating event starts on the first date its rule produces |
| `PATCH` / `DELETE /api/schedule/events/{id}` | creator, a listed person, an admin (for "everyone" events: creator or admin) | `scope` = `this` / `following` / `all` and `occurrence_date` for a repeating event |
| `GET /api/schedule/people` | verified | the people who can appear on an event (`id`, `name`, `color`, `active`): active users first, then disabled or deleted ones flagged `active: false` (shown muted, never offered for new events) |
| `GET /api/tasks?status&person` | verified | the tasks (`status` = `pending`/`in_progress`/`completed`/`all`; `person` = a user id, or `none` for the tasks for the whole team), to do first, then by due date, at most 1000; everyone sees every task in full |
| `POST /api/tasks` | verified | create a task for yourself, anyone, or the whole team |
| `GET` / `PATCH` / `DELETE /api/tasks/{id}` | read: verified; change or delete: the creator, a person on it, an admin | `PATCH` takes the whole form |
| `POST /api/tasks/{id}/complete`, `/start` (in progress), `/reopen` (back to to do) | whoever may edit it; anyone for a task for the whole team | idempotent: a task that already has that status is returned unchanged |
| `DELETE /api/tasks/completed` | verified | deletes the completed tasks the caller may delete; answers `{"deleted": n}` |
| `GET /api/tasks/categories`, `POST /api/tasks/categories` | verified | list (by name) and add a category |
| `PATCH` / `DELETE /api/tasks/categories/{id}` | admins and the super admin | rename, change the icon, or delete (its tasks are kept without a category) |
| `GET /api/schedule/reminders/due`, `POST /api/schedule/reminders/dismiss` | verified | reminders that are due for the signed-in person; dismissing hides all reminders of one occurrence |

The frontend pages (React Router in `frontend/src/App.tsx`; the card pages and the signed-in pages share one router and one query client):

| Path | Who | Content |
| --- | --- | --- |
| `/` | signed in: everyone; otherwise the sign-in form | the Dashboard: "My events" and "All events" for today and the next 7 days, and "My tasks" (your tasks and the whole team's: overdue, today, no date, tomorrow) (plus the two-step encouragement and the recovery-codes notice) |
| `/schedule` | signed in | the calendar: Day, Week, Month and Year views, event dialog, search, people filter, drag to move (`?view=week&date=2026-11-12&people=3,5&q=...`) |
| `/tasks` | signed in | the task list (or the board: To do, In progress, Done, with drag and drop): status tabs, people filter (`?people=3,5`), category chips, search, task dialog, category manager |
| `/account` | signed in | two-step verification, recovery codes, change password |
| `/settings` | signed in: everyone; otherwise the sign-in form | theme choice |
| `/admin` | admins and the super admin (a plain user sees the Dashboard) | the Users page: a list (face, name, email, role chip, a note when the account is not active) with search and a **+** that opens the invite dialog; tapping a row opens a dialog with that person's details and the actions the server allows |
| `/forgot-password`, `/set-password#token=...&lang=...` | anyone | recovery and invitation pages; the link's `lang` opens the page in the recipient's language |
| anything else | anyone | a friendly "page not found" |

Signed-in pages sit inside the **layout** (`app/Layout.tsx`, wrapped by `Shell.tsx`): a bottom bar on a phone, an icon rail from 768px and the full sidebar from 1024px (Dashboard, Schedule, Tasks, Users for admins and the super admin). The toggle at the top of the sidebar collapses it to the rail (a per-account preference). There is no top bar: the account menu (Account, Settings, Sign out) sits at the bottom of the sidebar, and pages use the full width beside it. The page title is small (about 15px). The on-screen reminders show on every page. People who are not signed in get a small FR / EN / PT picker instead; the choice is kept in this browser (`localStorage` key `kmk.lang`).

**Settings and preferences:** `/settings` (everyone) holds the language (saved on the server, see below), the theme (**KMK**, the green look that follows the OS light or dark preference; **Light** and **Dark**, forced neutral palettes) and a switch for each Dashboard card (My events, All events, My tasks). Preferences belong to the account and follow the person to every device: `users.preferences` (JSON) holds `theme`, `sidebar_collapsed`, `tasks_view`, `show_tasks_on_schedule` and `dashboard_widgets`, validated by a closed schema in `backend/app/preferences.py` (unknown keys or values are refused, `422`); `PATCH /api/me/preferences` merges any subset, and `/api/auth/me` and sign-in return the full set. The front end (`preferences.tsx`) applies a change at once and puts it back if the server refuses. The theme is also kept in `localStorage` (`kmk.theme`) only so a reload starts in the right look before the session loads. The language stays its own setting (`/api/auth/locale`).
A signed-in user's language is stored on the server (`users.locale`, changed with `POST /api/auth/locale`) and is also used for their emails; signing in applies it and saves it as the browser's preference. A user who still has to enter or set up two-step verification sees those screens on every path.

**Schedule code:** the backend is `backend/app/schedule/` (`recurrence.py` the repeat rule and series dates through `dateutil.rrule`, `occurrences.py` the expansion with one-off changes, `service.py`, `routes.py`); the repeat rule's JSON shape is `{"freq": "weekly", "interval": 1, "weekdays": ["THU"], "month_day": null, "nth_weekdays": [{"nth": 4, "day": "SAT"}]}`. The front end is `frontend/src/schedule/` (views, event dialog, drag, reminders), `frontend/src/dashboard/` (the two widgets) and `frontend/src/ui/` (shared pieces: buttons, dialog, avatars).
**Tasks:** `0008` adds the `in_progress` status and seeds ten starter categories (Cleaning, Supplies, Equipment, Clients, Vehicle, Maintenance, Training, Safety, Admin, Other; created by no one). A new category with no matching icon gets ✅. The view (list or board) is a per-account preference.

**Tasks code:** the backend is `backend/app/tasks/` (`schemas.py`, `service.py`, `routes.py`); the rules are `can_change_task`, `can_set_task_status` and `can_manage_task_categories` in `backend/app/auth/policy.py`. The front end is `frontend/src/tasks/` (page, row, dialog, categories, hooks), `frontend/src/dashboard/TasksCard.tsx` and the task chips in `frontend/src/schedule/` (`TaskChip.tsx`, `taskItems.ts`). Task strings start with `task` in the locale files.
The server serves the single-page app for any non-`/api`, non-`/assets` path.

## Pointers for the code

- Backend entry: `backend/app/main.py` (`create_app`, Origin check middleware, error handler). Routers in `backend/app/auth/`.
- The guard (`auth/guard.py`) decides what a session may call. MFA state logic is in `auth/service.py` (`state_for`, `mfa_state`).
- Who may do what to whom is decided in one place, `auth/policy.py`; the account state changes (disable, delete, role change, ...) are in `auth/lifecycle.py`; `auth/admin.py` calls them in that order (policy check, change, audit, commit).
- Settings: `backend/app/config.py` (each one explained in [operations.md](operations.md)); the compose file passes each container only the variables it needs.
- Backups and restore: `deploy/backup/` (scripts, systemd units, key ceremony). Dependency scan: `scripts/audit-deps.sh`. Tests for these live in `backend/tests/test_backup_scripts.py` and `test_deploy_config.py`.
- Frontend entry: `frontend/src/App.tsx` (switches between the screens); API client in `frontend/src/api.ts`.
