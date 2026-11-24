# Users page, avatars, Dashboard widget settings (round 3)

## Intent
Make Users look and work like Tasks, let people have a face instead of initials, and let each person decide which Dashboard cards they see.

## Goals
**Users page** (`/admin`, admins and super admin; behavior and authority rules unchanged)
- Same frame as Tasks: page header with search (magnifier) and a primary **+** button that opens the invite dialog (today an inline form). A "Show deleted" switch moves into the search area.
- A list of rows: avatar, name (or username), email, a role chip (Super admin / Admin / User) and a status chip (Invited / Disabled / Deleted shown only when not active). Tap a row: a dialog with that person's actions (edit name/email/language, resend invite, reset password, reset two-step, disable/enable, delete/restore, change role), reusing the existing confirm steps and `policy` actions list. No backend change for this part.

**Avatars**
- A person uploads their own picture on **Account** ("Change picture", "Remove"). An admin may remove anyone's picture (never upload for someone else).
- The browser crops it square and shrinks it (256x256, JPEG, at most 50 KB, like FamillAI's `prepareAvatar`), so nothing large or unusual reaches the server.
- Backend: table `user_avatars(user_id pk -> users, content_type, data bytea, updated_at)`; `PUT /api/me/avatar` (raw body, guarded, CSRF), `DELETE /api/me/avatar`, `DELETE /api/admin/users/{id}/avatar` (through `policy.check`), `GET /api/people/{id}/avatar` (guarded, verified session). The server accepts only JPEG, PNG or WebP by magic bytes and at most 50 KB, answers `422 {"error":"invalid_image"}` otherwise, and serves with the stored fixed content type, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox` and `Cache-Control: private, max-age=0, must-revalidate` plus an `ETag`. Audit rows `avatar_set` / `avatar_removed` (no content). Migration `0009` with `kmk_app` grants.
- `/api/schedule/people`, the admin list and `/api/auth/me` gain `avatar_url` (null or `/api/people/{id}/avatar?v=<updated_at epoch>`), so every `Avatar` (calendar, tasks, board, sidebar, users) shows the picture and falls back to initials.

**Preferences, per account (owner's decision: all preferences follow the person across devices)**
- New `users.preferences` (jsonb, default `{}`), validated by a closed schema: `theme` (kmk|light|dark), `sidebar_collapsed` (bool), `tasks_view` (list|board), `show_tasks_on_schedule` (bool), `dashboard_widgets` ({my_events, all_events, my_tasks}: bool, all on by default). `PATCH /api/me/preferences` takes any subset (`extra=forbid`, guarded, CSRF), merges, answers the full normalized set; `/api/auth/me` and login return `preferences` at the top level (not inside `user`, so admin lists never carry them).
- The front end keeps them in one `PreferencesProvider` (`usePreferences()` -> `{ prefs, update(patch) }`): changes apply at once and go to the server; a refused change is rolled back. The theme is also mirrored in `localStorage` only so the first paint after a reload is right before the session loads. The older per-device keys (`kmk.theme`, `kmk.sidebar.collapsed`, `kmk.tasks.view`, `kmk.schedule.showTasks`) are replaced by this (a stored value is not migrated: people start from the defaults).
- `/settings` gets a "Dashboard" section with a switch per card; the Dashboard shows only enabled cards, and if none, says so with a link to Settings.

## Non-goals
Cropping UI beyond a centered square crop, GIF/animated pictures, picture history, uploads by admins for others, per-role widget rules, new widgets.

## Approaches
1. **Store the 50 KB image in Postgres** (as FamillAI does). Recommended: backups already cover the database (encrypted), no new service or volume, auth-guarded serving.
2. Files on disk in a Docker volume: needs a new volume, backup changes and path-safety work. Rejected.
3. Gravatar or similar: sends emails to a third party. Rejected.

## Calls made by me
- Own-picture only, plus admin remove (a moderation need, cheap).
- Row click opens a dialog with the existing actions (rather than the current inline buttons per row).
- Preferences are per account (owner's decision), stored as one validated JSON column rather than a column each, so a new preference needs no migration.
- Validation by magic bytes and size, not re-encoding on the server (no new dependency); the browser does the re-encoding and the serving headers contain the risk.

## Tests
Backend: upload accepts a small JPEG, rejects wrong type / over 50 KB / empty, replaces, delete; unauthenticated and half-authenticated (MFA) refused (guard test); a plain user cannot delete another's picture, an admin can; avatar_url in the people list; audit rows. Frontend: Users list + dialog + invite via +; avatar picker flow with a mocked `prepareAvatar`; `Avatar` shows an image when `avatar_url` is set; widget switches hide cards and persist.
