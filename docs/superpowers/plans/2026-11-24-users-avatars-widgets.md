# Users, Avatars and Account Preferences Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Per-account preferences (theme, sidebar, tasks view, schedule tasks switch, Dashboard widgets), profile pictures, and a Tasks-style Users page.

**Architecture:** Migration `0009` adds `users.preferences jsonb` and `user_avatars`. A closed pydantic schema validates preferences; one `PreferencesProvider` serves them to the UI. Avatars are 50 KB images in Postgres, served by a guarded route; the browser prepares the image. Users page reuses the existing admin API and row actions inside a dialog.

**Tech Stack:** FastAPI, SQLAlchemy, hand-written Alembic, React, TanStack Query, vitest, pytest.

**Spec:** `docs/superpowers/specs/2026-11-24-users-avatars-widgets-design.md`

## Global Constraints

- Preferences schema (defaults): `theme` "kmk", `sidebar_collapsed` false, `tasks_view` "list", `show_tasks_on_schedule` false, `dashboard_widgets` {my_events, all_events, my_tasks} all true. Unknown keys: 422 `{"error": ...}` (extra forbid).
- Avatars: JPEG/PNG/WebP by magic bytes, 1 to 51200 bytes; 422 `invalid_image` otherwise. Serve with the stored content type, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox`, `Cache-Control: private, max-age=0, must-revalidate`, ETag.
- Every protected route uses `Depends(guard())` (the half-authenticated test must pass); authority via `policy.check`; audit via `audit.log` (plain INSERT, no content); `kmk_app` grants in the migration; hand-written SQL; `app/models.py` in step; three locale files; docs updated.
- Run backend with `cd backend && .venv/bin/pytest -q <paths>` (full suite takes ~4.5 min: run once, in the background, never two at once); frontend `cd frontend && npx vitest run`.

## Review Focus

- A plain user cannot delete someone else's picture; unauthenticated and half-authenticated requests are refused.
- A non-image or over-50 KB upload, and an SVG/HTML payload renamed as an image, are refused.
- A preference PATCH with an unknown key or bad value changes nothing.
- A refused preference change rolls back in the UI; first paint after reload uses the cached theme, then the server's.
- Admin list responses do not contain preferences or picture bytes.

### Task 1: Backend preferences
**Files:** create `backend/alembic/versions/0009_preferences_avatars.py` (both columns/tables, written here), `backend/app/preferences.py` (schema + merge), tests `backend/tests/test_preferences_api.py`; modify `models.py`, `auth/service.py` (`auth_payload` adds `preferences`), `auth/account.py` (route `PATCH /api/me/preferences`; check how routers are prefixed and mount under `/api/me` or the existing account router as `/api/auth/preferences` if `/api/me` does not exist: ruling allowed, keep the front end in step).
**Produces:** `normalize(raw: dict | None) -> dict` (defaults filled, invalid stored values dropped); `PreferencesIn` (all optional, `extra="forbid"`); the route returns `{"preferences": {...}}`.
- [ ] Failing tests: defaults in `/api/auth/me`; PATCH one key persists and merges with others; nested `dashboard_widgets` partial merge; unknown key 422; bad value 422; unauthenticated 401; half-authenticated refused (add to the guard test's coverage by virtue of `guard()`); admin user list has no `preferences`.
- [ ] Implement migration (preferences column NOT NULL DEFAULT '{}'; `user_avatars(user_id bigint PK REFERENCES users ON DELETE CASCADE, content_type text NOT NULL CHECK in image/jpeg|png|webp, data bytea NOT NULL CHECK length 1..51200, updated_at timestamptz DEFAULT now())`; `GRANT SELECT, INSERT, UPDATE, DELETE ON user_avatars TO kmk_app`; kmk_app needs UPDATE on users.preferences: check existing grants), model, schema, route.
- [ ] Run the focused tests (PASS). Commit `feat(preferences): per-account preferences API`.

### Task 2: Backend avatars
**Files:** create `backend/app/auth/avatars.py` (router), `backend/tests/test_avatars_api.py`; modify `main.py` (include router), people payload in `app/schedule/service.py` and admin list in `auth/admin.py` (add `avatar_url`), `auth/service.py` `user_payload` (add `avatar_url`), `models.py`, `auth/policy.py` (`can_remove_avatar(actor, target)`: self or admin who may act on the target... reuse `policy.check` style), `tests/test_mfa_guard.py` only if routes need listing.
**Produces:** `PUT /api/me/avatar` (raw body, `Content-Type` image/*), `DELETE /api/me/avatar`, `DELETE /api/admin/users/{id}/avatar`, `GET /api/people/{id}/avatar`; `avatar_url(user_id, updated_at) -> str | None` helper returning `/api/people/{id}/avatar?v=<epoch>`.
- [ ] Failing tests: valid tiny JPEG/PNG/WebP accepted; replace keeps one row; text/SVG/HTML body 422; 51201 bytes 422; empty 422; GET returns bytes with the headers above and honors `If-None-Match`; GET unauthenticated 401; DELETE own; plain user DELETE other 403; admin DELETE other 204 (and only if the admin may act on that user per policy); audit rows `avatar_set`/`avatar_removed` contain no content; people list and `/auth/me` user carry `avatar_url`; null when none.
- [ ] Implement; magic bytes: JPEG `FFD8FF`, PNG `89504E470D0A1A0A`, WebP `RIFF....WEBP`. Read the body with a hard cap (reject before reading more than 51201 bytes).
- [ ] Run focused tests, then the full suite once in the background. Commit `feat(avatars): profile pictures`.

### Task 3: Frontend preferences
**Files:** create `frontend/src/preferences.tsx` (+test), modify `api.ts` (`Session.preferences`, `updatePreferences(csrf, patch)`), `App.tsx` (provider), `testUtils.tsx` (Providers wrap a provider with defaults and no network unless a test passes `preferences`), `theme.ts`, `app/useSidebarCollapsed.ts`, `tasks/useTasksView.ts`, `schedule/taskItems.ts` (`useShowTasks`), `SettingsPage.tsx`, `dashboard/DashboardPage.tsx`, locales, and the existing tests that asserted localStorage keys.
**Produces:** `type Preferences = { theme: Theme; sidebar_collapsed: boolean; tasks_view: "list"|"board"; show_tasks_on_schedule: boolean; dashboard_widgets: { my_events: boolean; all_events: boolean; my_tasks: boolean } }`; `DEFAULT_PREFERENCES`; `PreferencesProvider({ initial, csrfToken, children })`; `usePreferences(): { prefs: Preferences; update(patch: DeepPartial<Preferences>): void }`. The existing hooks keep their return shapes and become thin wrappers over `usePreferences`.
- [ ] Failing tests: `update` changes `prefs` at once and PATCHes; a 4xx rolls it back; theme is applied to `<html data-theme>` and mirrored in `localStorage["kmk.theme"]`; Settings shows the three Dashboard switches, toggling one PATCHes `dashboard_widgets`; Dashboard hides a disabled card and shows an "all hidden" message with a Settings link when none; `useSidebarCollapsed`, `useTasksView`, `useShowTasks` read and write through preferences.
- [ ] Implement; keys `settingsDashboard`, `settingsWidgetMyEvents`, `settingsWidgetAllEvents`, `settingsWidgetMyTasks`, `dashAllHidden`, `dashAllHiddenLink` in en/fr-CA/pt-BR.
- [ ] Full frontend suite + build PASS. Commit `feat(settings): preferences follow the account, Dashboard widget switches`.

### Task 4: Frontend avatars
**Files:** create `frontend/src/ui/prepareAvatar.ts` (+test), `frontend/src/AvatarPicker.tsx` (+test); modify `ui/Avatar.tsx`, `ui/ui.css`, `AccountPage.tsx`, `api.ts`, `schedule/types`/people mapping (`avatar_url`), `person.ts`, `app/AccountMenu.tsx`, locales.
**Produces:** `prepareAvatar(file: File): Promise<Blob>` (center-crop square, 256x256 JPEG at decreasing quality until at most 51200 bytes; rejects non-images with an `Error("invalid_image")`); `Person.avatar_url?: string | null`; `Avatar` renders `<img>` (alt empty when decorative) when `avatar_url` is set, falling back to initials on error.
- [ ] Failing tests: `Avatar` shows an image and keeps initials otherwise; picker calls the upload with the prepared blob (mock `prepareAvatar`), shows the new picture, can remove; wrong file shows the error text; Account page has the picker.
- [ ] Implement; the account menu and sidebar use the signed-in user's `avatar_url`.
- [ ] Suite + build PASS. Commit `feat(avatars): upload and show pictures`.

### Task 5: Users page
**Files:** create `frontend/src/users/UsersPage.tsx`, `UserRow.tsx`, `UserDialog.tsx`, `InviteDialog.tsx`, `users.css`; modify `App.tsx` (route renders the new page), remove or reduce `AdminPage.tsx`/`AdminInvite.tsx`/`AdminUserRow.tsx` once unused; update `Admin.test.tsx`; locales.
**Produces:** page with `PageHeader` (search toggle, primary + opens `InviteDialog`), rows (avatar, name, email, role chip, status chip when not active), row tap opens `UserDialog` with the existing edit and action flows (same confirm steps and `actions` list from the API); admin picture removal in the dialog when the user has one.
- [ ] Failing tests (adapt `Admin.test.tsx`): list shows people with chips; search filters; + opens the invite dialog and posts the invite; a row opens the dialog; actions appear only as the API's `actions` allow; confirm steps still gate reset password / disable / delete; show-deleted switch.
- [ ] Implement; keep behavior and API calls identical, change only the presentation.
- [ ] Suite + build PASS. Commit `feat(users): Tasks-style Users page`.

### Task 6: Docs
- [ ] `docs/README.md` (endpoints, tables, settings page, Users page), `docs/security.md` (avatars: validation, serving headers, audit actions, preferences are not security data), `docs/roadmap.md` if needed. Commit `docs: preferences, avatars, users page`.
