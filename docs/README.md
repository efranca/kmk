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
| 9 Quotes | the open quote form at `/devis` (public site's look, fr-CA/en-CA/pt-BR, photos, 10 requests per hour per IP), the admins' Quotes area (request as sent, conversation kept by hand for customer replies, status), a shared task due in 24 h and an Agenda deadline for every admin, a notification email and Web Push, company-wide System settings, an installable app | done; owner steps remain (VAPID keys, Resend sender domain, settings, link from the public site) | [spec](superpowers/specs/2026-11-25-quotes-design.md) | [plan](superpowers/plans/2026-11-25-quotes.md) |
| Calendar feed | a personal secret `.ics` link per user (Account page) with the events they are listed on, title and time only, for FamillAI, Google, Apple or Outlook | done | [spec](superpowers/specs/2026-11-26-calendar-feed-design.md) | [plan](superpowers/plans/2026-11-26-calendar-feed.md) |
| Invoices | admins bill a client's past Agenda cleanings (priced from the property's price per visit), plus manual lines and extra costs, into a numbered French PDF invoice (first number 007, never reused), saved as an admins-only Document linked to the client; unpaid / paid / cancelled, optional email with the PDF attached. No tax calculation yet (the TVA line prints 0,00 $) | done | [spec](superpowers/specs/2026-11-27-invoices-design.md) | [plan](superpowers/plans/2026-11-27-invoices.md) |
| 6 Hardening | encrypted verified backups, container limits and health checks, dependency scan, independent security review, go-live runbook | built; go-live waits for the owner's steps (key, Resend, two-step, pilot) | [spec](superpowers/specs/2026-11-17-phase6-hardening-design.md) | [plan](superpowers/plans/2026-11-17-kmk-phase6-hardening.md) |

## Data model (as built)

Tables, all created by the migrations in `backend/alembic/versions/`:

| Table | Purpose | Key columns |
| --- | --- | --- |
| `users` | accounts | `username`, `name` (the person's display name, 1-100 characters, optional in the database for accounts that predate it), `email` (both lowercase, unique), `password_hash` (Argon2id, null until an invite is accepted), `role` (`user`/`admin`/`superadmin`; one super admin allowed; shown as Staff / Administrator / Administrator),`settings` (JSON, admin-managed, closed: `notify_quotes`; see `app/user_settings.py`), `locale` (`fr-CA`/`en`/`pt-BR`/`es`), `status` (`invited`/`active`/`disabled`/`deleted`), `mfa_enabled`, `mfa_secret` (Fernet-encrypted), `mfa_last_step`, `preferences` (JSON: theme, sidebar, tasks view, Schedule tasks switch, Dashboard widgets), `avatar_updated_at` (NULL = no picture) |
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
| `quotes` | one quote request (a `draft` until the customer presses Send, then `new`, `replied`, `customer_replied`, `won`, `lost`) | `reference` (`D-` + id, computed), `kind` (`airbnb`/`commercial`), `name`, `email`, `phone`, `locale`, `details` (JSON: address, property, frequency, bedrooms, bathrooms, area), `message` (up to 2000 words), `internal_note`, `ip`, `ip_key` (IPv6 per /64, counted for the hourly limit), `geo_*`, `user_agent`, `token_hash` (the draft's one-time token), `deadline_at` (24 h), `first_reply_at`, `task_id`, `event_id`, `source` (`web`/`manual`), `created_by` (who entered a manual one) |
| `quote_photos` | up to 10 photos of 8 MiB (JPEG, PNG, WebP, HEIC) | `quote_id`, `content_type`, `size`, `data` |
| `quote_messages` | the conversation: `out` is emailed from the app, `in` is a customer reply pasted by an admin | `direction`, `subject`, `body`, `author_id`, `sent_at`, `delivery` (`sent`/`failed`, out only) |
| `app_settings` | company-wide settings (`quote_notify_email`, `quote_from`, `quote_reply_to`, `public_phone`) | `key`, `value`, `updated_by` |
| `push_subscriptions` | one device of an admin that turned notifications on | `user_id`, `endpoint`, `p256dh`, `auth` |
| `calendar_feeds` | one personal calendar feed link per user | `user_id` (primary key), `token_hash` (SHA-256, unique), `created_at`, `last_used_at` |
| `clients` | someone the company works for; tasks, events, documents and quotes point to one with `client_id` (`ON DELETE SET NULL`) | `name`, `kinds` (one or more of `airbnb`/`commercial`/`post_construction`/`other`), `contact_name`, `email`, `phone`, `address`, `city`, `notes` (admins only), `created_by`, `updated_by` |
| `properties` | a place that belongs to a client (house, Airbnb, office); an Agenda item says which one it is for (`events.property_id`, must be its own client's; set null when deleted) | `client_id` (cascade), `name`, `kind`, `address`, `city`, `listing_url` (web links only), `access_notes` (door code, key: Staff on the client's jobs see it), `visit_price` (`numeric(10,2)`, optional, what one visit costs; administrators only, Staff never receive it) |
| `invoices` | one invoice (admins only); the billed-to data is a snapshot, so later edits of the client do not change it | `number` (unique, shown as `007`), `client_id` (set null when the client is deleted), `bill_name`/`bill_address`/`bill_city`/`bill_phone`/`bill_email`, `issued_on`, `status` (`unpaid`/`paid`/`cancelled`), `paid_on` (set exactly when paid), `subtotal`, `tax` (always 0 for now), `extra`, `total` (`numeric(10,2)`), `sent_at`, `cancelled_at`, `document_id` (the stored PDF; set null if that document is deleted), `created_by`, `updated_by` |
| `invoice_lines` | one line of an invoice: an Agenda occurrence (`event_id` + `occurrence_date`, the occurrence's original date, as in `event_exceptions`) or a manual line (both null) | `invoice_id` (cascade), `position`, `description` (1-200), `amount` (0-99999.99), `event_id` (set null), `occurrence_date`, `live` (false once the invoice is cancelled). A partial unique index on `(event_id, occurrence_date) WHERE live` makes billing the same cleaning twice impossible |
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
| `POST /api/auth/locale` | verified | set your own interface and email language (`fr-CA`, `en`, `pt-BR`, `es`) |
| `POST /api/auth/mfa/setup` | verified or `setup` state | start enrollment, returns the secret and `otpauth://` URI |
| `POST /api/auth/mfa/enable` | verified or `setup` state | confirm a code, returns the 10 recovery codes once |
| `POST /api/auth/mfa/verify` | `verify` state | second login step: a code or a recovery code |
| `POST /api/auth/mfa/disable` | verified | needs password and a code; refused for roles in `MFA_REQUIRED_ROLES` |
| `POST /api/auth/mfa/recovery-codes/regenerate` | verified | needs password and a code |
| `PUT /api/me/avatar`, `DELETE /api/me/avatar` | verified | set (raw JPEG, PNG or WebP body, at most 50 KB, `422 invalid_image` otherwise) or remove your own picture |
| `DELETE /api/admin/users/{id}/avatar` | verified admin or super admin, with the same authority as editing that person | take down someone's picture (nobody can put one up for someone else) |
| `GET /api/people/{id}/avatar` | verified | the picture (with `ETag`); `404` when there is none. Every user payload and the people list carry `avatar_url` |
| `PATCH /api/me/preferences` | verified | change preferences (see Settings and preferences) |
| `GET /api/version` | verified | `{version, commit, built_at}` of the running API build (see About) |
| `GET /api/documents` | verified | the documents this person may see (metadata only) and all categories |
| `POST /api/documents` | verified admin or super admin | create a document's details (it stays pending, creator-only, until its file arrives; pending ones older than an hour are purged) |
| `GET/PATCH/DELETE /api/documents/{id}` | verified; writes admin or super admin | read, change or delete one document; a document the caller may not see is `404`, the same as a missing one |
| `PUT /api/documents/{id}/preview` / `GET` | admin or super admin / verified | the tiles view's small JPEG (only a JPEG, at most 100 KB; hidden documents answer `404`) |
| `PUT /api/documents/{id}/file` | verified admin or super admin | the raw file as the body (`X-File-Name`, percent-encoded): add or replace; at most 2 uploads at once (`503 busy`) |
| `GET /api/documents/{id}/file[?download=1]` | verified | the file, served with `nosniff`, `Content-Security-Policy: sandbox`, `Cache-Control: private, no-store` |
| `POST/PATCH/DELETE /api/document-categories[/{id}]` | verified admin or super admin | document categories (deleting one keeps its documents) |
| `GET/POST /api/clients`, `GET/PATCH/DELETE /api/clients/{id}` | verified; writes admin or super admin. Staff read only the clients they are scheduled for (an Agenda item that lists them), without `notes`, and their detail has only their own events; others are 404 | list (`?q=` searches name, contact, email, phone, address, city), create (with `quote_id` it links that quote), read (with its linked tasks, events, documents, quotes), change, delete (links are cleared) |
| `POST /api/clients/{id}/properties`, `PATCH/DELETE /api/properties/{id}` | admin or super admin | add, change, delete a property (the client's detail carries its `properties`, for Staff too) |
| `GET /api/clients/{id}/billable?from=&to=` | admin or super admin | the client's past, non-cancelled, not-yet-billed occurrences in the period (`to` is cut at today in the company time zone), each with its property's price and a default description; `422 bad_range` |
| `POST /api/invoices` | verified admin or super admin | create and issue an invoice in one step: `client_id`, `issued_on`, `extra`, 1-100 `lines` (Agenda lines `event_id` + `occurrence_date`, or manual); numbers are gap-free from 007 (an advisory lock serializes them); `409 already_billed`, `422 occurrence_not_billable` / `duplicate_line` / `client_not_found`; stores the PDF as an admins-only Document of the client under "Factures" |
| `GET /api/invoices[?status=&q=]`, `GET /api/invoices/{id}` | admin or super admin | the list (newest number first; `q` matches the number, name or city) with `unpaid_total`, and one invoice with its lines |
| `POST/DELETE /api/invoices/{id}/payment`, `POST /api/invoices/{id}/cancel` | verified admin or super admin | mark paid on a date not after today (`422 bad_date`) or undo it, and cancel (the number is kept, its occurrences become billable again, the document's title gets "(annulée)"); `422 bad_status` when the invoice is not in the right state |
| `GET /api/invoices/{id}/pdf`, `POST /api/invoices/{id}/send` | admin or super admin | download the stored PDF (drawn again from the snapshot if its document was deleted); email it to `{"to": ...}` with the PDF attached, from the quote sender settings (`502 email_failed` changes nothing) |
| `GET /api/admin/devices` | verified **super admin only** | every active session grouped by person: id (a public uuid, never the token), browser string, start, last access, last address, approximate country and city |
| `DELETE /api/admin/devices/{id}` | super admin only | end one session (404 `device_not_found` if unknown or already ended; ending your own session is a sign-out) |
| `POST /api/admin/users/{id}/devices/logout-all` | super admin only | end every session of one person |
| `GET /api/admin/users` | verified admin or super admin | all accounts with role, status, two-step state, last sign-in, and the `actions` the caller may take on each row |
| `POST /api/admin/users` | verified admin or super admin | create and invite an account: a **name** is required; role `user`, or `admin` for the super admin only |
| `PATCH /api/admin/users/{id}` | verified admin or super admin (per [authority](security.md#administration-authority-and-account-lifecycle)) | change name or language; change email only while the account is `invited` (the super admin may also edit their own account) |
| `PATCH /api/admin/users/{id}/settings` | as above (the `edit` rule) | change the person's admin-managed settings (`notify_quotes`; administrators only; unknown keys refused) |
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
| `GET /api/public/quotes/config` | anyone | the public phone number |
| `POST /api/public/quotes` | anyone, 10 started requests per hour per IP | starts a draft; answers `{id, token}` (`429 rate_limited` over the limit; `422 too_long` over 2000 words) |
| `PUT /api/public/quotes/{id}/photos` | the draft's token (`X-Quote-Token`) | one photo as the raw body |
| `POST /api/public/quotes/{id}/submit` | the draft's token | makes it a request: creates the task and the Agenda item, then emails and pushes; answers `{reference}`; sending twice changes nothing |
| `GET /api/quotes?status`, `GET /api/quotes/{id}`, `GET /api/quotes/{id}/photos/{photo_id}` | admins and the super admin | list (with the counts for the navigation badge), one request, one photo |
| `POST /api/quotes` | admins and the super admin | enter a quote by hand (a phone call): name, phone and type are required; email, address, property, frequency, notes and client are optional. It starts New with the 24-hour deadline (`source` = `manual`, `created_by`) and makes no task, Agenda item, email or push. A reply cannot be emailed without an email (`422 no_email`); a customer reply can still be logged |
| `PATCH /api/quotes/{id}` | admins and the super admin | status, internal note, client |
| `POST /api/quotes/{id}/messages`, `POST /api/quotes/{id}/messages/{mid}/retry` | admins and the super admin | send a reply by email (`409 sender_not_configured` without a sender) or paste a customer reply; retry a failed send |
| `DELETE /api/quotes/{id}` | super admin | delete the request, its photos and its conversation |
| `GET` / `PATCH /api/settings/system` | super admin | the company-wide settings |
| `GET /api/push/key`, `POST` / `DELETE /api/push/subscriptions`, `POST /api/push/test` | admins and the super admin | Web Push for this device |
| `DELETE /api/tasks/completed` | verified | deletes the completed tasks the caller may delete; answers `{"deleted": n}` |
| `GET /api/tasks/categories`, `POST /api/tasks/categories` | verified | list (by name) and add a category |
| `PATCH` / `DELETE /api/tasks/categories/{id}` | admins and the super admin | rename, change the icon, or delete (its tasks are kept without a category) |
| `GET /api/schedule/reminders/due`, `POST /api/schedule/reminders/dismiss` | verified | reminders that are due for the signed-in person; dismissing hides all reminders of one occurrence |
| `GET` / `POST` / `DELETE /api/account/calendar-feed` | verified (POST and DELETE need CSRF) | whether you have a feed link; create or replace it (returns the link once: `{url, created_at}`); revoke it |
| `GET /api/schedule/feed/{token}.ics` | public, the token is the credential | your listed events as iCalendar, title and time only, 31 days back to 365 ahead; every failure is `404 not_found` |

The frontend pages (React Router in `frontend/src/App.tsx`; the card pages and the signed-in pages share one router and one query client):

| Path | Who | Content |
| --- | --- | --- |
| `/` | signed in: everyone; otherwise the sign-in form | the Dashboard: "My events" and "All events" for today and the next 7 days, and "My tasks" (your tasks and the whole team's: overdue, today, no date, tomorrow); admins and the super admin also get "Quotes" (Needs reply, Waiting on customer, Overdue, each opening its tab of the Quotes list) and "Latest quotes" (the five newest requests) (plus the two-step encouragement and the recovery-codes notice) |
| `/schedule` | signed in | the calendar: Day, Week, Month and Year views, event dialog, search, people filter, drag to move (`?view=week&date=2026-11-12&people=3,5&q=...`) |
| `/tasks` | signed in | the task list (or the board: To do, In progress, Done, with drag and drop): status tabs, people filter (`?people=3,5`), category chips, search, task dialog, category manager |
| `/account` | signed in | two-step verification, recovery codes, change password |
| `/documents` | signed in: everyone (administrators add and change) | the company library |
| `/invoices`, `/invoices/{id}` | admins and the super admin (Staff see the Dashboard) | the invoices list (tabs All / Unpaid / Paid / Cancelled, search, what is still unpaid) and one invoice (PDF, mark paid, send, cancel); invoices are made with **Bill** on a client's Invoices tab |
| `/devices` | signed in, super admin only (others land on the Dashboard) | connected devices by person, with Sign out per device or for all of a person's |
| `/settings` | signed in: everyone; otherwise the sign-in form | language, theme, Dashboard cards (cards side by side as the width allows) |
| `/about` | signed in: everyone (from the account menu) | version, commit and build time of the app and the server |
| `/admin` | admins and the super admin (a plain user sees the Dashboard) | the Users page: a list (face, name, email, role chip, a note when the account is not active) with search and a **+** that opens the invite dialog; tapping a row opens a dialog with that person's details and the actions the server allows |
| `/forgot-password`, `/set-password#token=...&lang=...` | anyone | recovery and invitation pages; the link's `lang` opens the page in the recipient's language |
| anything else | anyone | a friendly "page not found" |

Signed-in pages sit inside the **layout** (`app/Layout.tsx`, wrapped by `Shell.tsx`): a bottom bar on a phone (the pages that do not fit go behind a "More" button that opens a sheet of links; the names under the icons can be turned off in Settings), an icon rail from 768px and the full sidebar from 1024px (Dashboard, Schedule, Tasks, Users for admins and the super admin). The toggle at the top of the sidebar collapses it to the rail (a per-account preference). There is no top bar: the account menu (Account, Settings, Sign out) sits at the bottom of the sidebar, and pages use the full width beside it. The page title is small (about 15px). The on-screen reminders show on every page. People who are not signed in get a small FR / EN / PT picker instead; the choice is kept in this browser (`localStorage` key `kmk.lang`).

**Settings and preferences:** `/settings` (everyone) holds the language (saved on the server, see below), the theme (**Light** by default, also on the sign-in page and for anyone who never chose one; **KMK**, the green look that follows the OS light or dark preference; **Dark**, a forced neutral palette) and a switch for each Dashboard card (My events, All events, My tasks, and for admins Quotes summary and Latest quotes). Preferences belong to the account and follow the person to every device: `users.preferences` (JSON) holds `theme`, `sidebar_collapsed`, `tasks_view`, `show_tasks_on_schedule`, `show_task_categories` and `show_document_categories` (the category chips on the Tasks and Documents pages, off until the tag button is pressed; on a phone the task categories are a dropdown beside the faces), `show_task_people` and `show_schedule_people` (the faces filter on the Tasks and Schedule pages, on until switched off in the gear menu) `documents_view` (`list` or `tiles`), `show_menu_labels` (page names in the phone's bottom bar, off by default: icons only until turned on) and `dashboard_widgets`, validated by a closed schema in `backend/app/preferences.py` (unknown keys or values are refused, `422`); `PATCH /api/me/preferences` merges any subset, and `/api/auth/me` and sign-in return the full set. The front end (`preferences.tsx`) applies a change at once and puts it back if the server refuses. The theme is also kept in `localStorage` (`kmk.theme`) only so a reload starts in the right look before the session loads. The language stays its own setting (`/api/auth/locale`).

**Documents** (`/documents`): the company library. Each document has a title, an optional note and category, **one file** (at most **50 MB**) and a **visibility**: *Everyone*, *Administrators* or *Super administrator only*. People see the levels up to their role (user: everyone; admin: + administrators; super admin: all); admins and the super admin add, change, replace and delete what they can see, and can only set levels up to their own. New documents default to *Administrators*. **File types** are decided by the file's contents (`backend/app/documents/files.py`): images (JPEG, PNG, WebP, GIF, AVIF, BMP; HEIC and TIFF are kept but drawn as an icon), PDF, text (`txt md markdown csv tsv json log`, accepted by extension plus a UTF-8/no-binary check), RTF, and Office (DOCX, XLSX, PPTX, ODT, ODS, ODP as real packages with the right inner files; DOC, XLS, PPT by extension). Refused: archives, programs, scripts, HTML, SVG. PDFs, drawable images and text open in the tab (text as `text/plain`); everything else is always a download. Limits (`backend/app/documents/limits.py`, constants): 500 documents, 2 GB for the library, 50 MB a file; the first one reached refuses the upload and says which. The bytes live in Postgres (`document_files`, apart from the metadata so lists never read them), so they are in every encrypted backup. Upload is two steps (details, then the raw file) so nothing half-made stays visible, then a best-effort **preview**. Photos over 1.5 MB are scaled in the browser to about 2400 px. **Views:** the gear is a View menu like Tasks (List or Tiles, plus Manage categories; the choice is the per-account `documents_view`), and a tag button shows or hides the category chips. **Previews** are made in the browser when a file is added or replaced (an image scaled to fit 360 px, the first lines of a text file, the first page of a PDF through `pdfjs-dist`, loaded only when a PDF is chosen, its worker a same-origin asset) as a JPEG of at most 60 KB, stored in `document_previews` (the server accepts only a JPEG up to 100 KB) and served at `GET /api/documents/{id}/preview` under the same visibility rule as the file; Office files, HEIC and TIFF show an icon, and documents added before previews existed show one until their file is replaced. Search is in the browser over title, note, category and file name. Caddy lets only `PUT /api/documents/{id}/file` carry up to 51 MiB and `PUT .../preview` up to 128 KB; every other API body stays at 64 KB. The API container has 1.5 GB of memory, and uploads are limited to 2 at once.

**Connected devices** (`/devices`, super admin only): each session row in `sessions` has a public `id`, `last_seen_at`, `last_ip`, `country` and `city`. Last access is written by the guard at most once every 5 minutes per session; the place comes from Cloudflare (`Cf-Ipcountry`, and `Cf-Ipcity` when the visitor-location transform is on), which Caddy copies into `X-Geo-Country` / `X-Geo-City` (overwriting anything the browser sent). The API believes them only from a trusted proxy peer and sanitizes them (two capital letters; city without control characters, at most 100 characters). Location is approximate and informational: never a security decision. Signing a device out ends that session only (it can sign in again with the password); the page says so.

**About** (`/about`, reached from the account menu) shows, for the app and for the server, the version, the commit and the build time. The version is `major.minor.<commit count>`: major and minor come from `frontend/package.json` and `backend/pyproject.toml` (raised by hand for a release with user-visible changes), the third number is `git rev-list --count HEAD`, so every deploy of a newer commit shows a higher version. The app's values are fixed by Vite at build time (`frontend/scripts/appVersion.ts`); the API's come from the image (`APP_COMMIT`, `APP_COMMIT_COUNT`, `APP_BUILT_AT`, build args set by auto-deploy) and are served by the guarded `GET /api/version`. A manual `docker compose up --build` without them shows an empty commit and "Unknown" build time. When the two commits differ the page says so (half-finished deploy or an old tab). Without usable git history (no git, shallow clone) the package version is shown as is.
A signed-in user's language is stored on the server (`users.locale`, changed with `POST /api/auth/locale`) and is also used for their emails; signing in applies it and saves it as the browser's preference. A user who still has to enter or set up two-step verification sees those screens on every path.

**Schedule code:** the backend is `backend/app/schedule/` (`recurrence.py` the repeat rule and series dates through `dateutil.rrule`, `occurrences.py` the expansion with one-off changes, `service.py`, `routes.py`); the repeat rule's JSON shape is `{"freq": "weekly", "interval": 1, "weekdays": ["THU"], "month_day": null, "nth_weekdays": [{"nth": 4, "day": "SAT"}]}`. The front end is `frontend/src/schedule/` (views, event dialog, drag, reminders), `frontend/src/dashboard/` (the widgets) and `frontend/src/ui/` (shared pieces: buttons, dialog, avatars).
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
