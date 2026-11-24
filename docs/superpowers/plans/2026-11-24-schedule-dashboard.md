# Schedule and Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give KMK a shared Schedule (Day, Week, Month, Year, repeating events, reminders, drag to move) and a Dashboard home page with "My events" and "All events" widgets, in FamillAI's layout and KMK's colors.

**Architecture:** A new `app/schedule/` FastAPI package (pure repeat logic, service, routes) on a new migration `0006`, and a React front end ported from FamillAI's `ui/src/features/schedule/` into `frontend/src/schedule/`, restyled on KMK's tokens. The app moves to React Router and TanStack Query. Repeating events are stored as one row and expanded on read.

**Tech Stack:** FastAPI, SQLAlchemy 2, Alembic, PostgreSQL, `python-dateutil` (new), React 19, Vite, Vitest, `react-router`, `@tanstack/react-query` (both new).

**Spec:** `docs/superpowers/specs/2026-11-24-schedule-dashboard-design.md` (read it first; its "Calls made after the builder check" section is binding).

**Reference (read only, never edit):** FamillAI at `/home/user/famillai`: UI `ui/src/features/schedule/`, repeat logic `api/src/main/java/com/famillai/domain/{Recurrence,Occurrences}.java`, series behavior `api/src/main/java/com/famillai/services/EventService.java` (Javadoc on `update`/`delete`), tests `api/src/test/java/com/famillai/unit/OccurrencesTest.java`, contract `documents/API.md` (Schedule, line ~1239), schema `api/src/main/resources/db/migration/V12__schedule.sql`.

## Global Constraints

- Branch: `claude/kmk-famillai-layout-features-n569w0` in `/home/user/kmk`. **Never modify `/home/user/famillai`.**
- Every route uses `Depends(guard())`; `tests/test_mfa_guard.py` must pass unchanged (it calls every route in the API description with half-authenticated sessions).
- Authority rules live in `backend/app/auth/policy.py`. Audit with `audit.log(...)` (plain INSERT, never `RETURNING`); audit details hold ids and field names, never notes text.
- Error bodies are `{"error": "<code>"}`. Hand-written Alembic SQL; `app/models.py` kept in step. `kmk_app` gets `SELECT, INSERT, UPDATE, DELETE` on each new table.
- Tests first, and watch each fail before implementing. Tests never use the real database (`kmk_test` only).
- Company time zone constant `America/Toronto`; dates and times are wall-clock values, never converted. Grid emphasis hours: weekdays 07:00-20:00, weekends 08:00-20:00. Event colors: `red, orange, amber, green, teal, blue, violet, pink`. Repeat `interval` 1-99; at most 5 `nth_weekdays`; at most 10 reminders per event (`amount` 1-99, unit `hours|days|weeks`); title 1-200 characters; duration 1-1440 minutes; range at most 400 days.
- Every UI string goes into `frontend/src/locales/{fr-CA,en,pt-BR}.json` (a test checks the key sets match). Colors come from the tokens in `frontend/src/index.css`; light and dark follow the system.
- Commit steps use the repository's `Co-Authored-By` trailer. Keep `docs/` accurate in the task that changes behavior.

## Review Focus

- A monthly rule on the 31st, or on "the 5th Saturday": months without that date have no occurrence and nothing crashes (Task 1).
- A series crossing the daylight-saving change keeps "18:00" at 18:00 (Task 3).
- A range over 400 days or `to` before `from` answers `422` with `range_too_large` / `bad_range`, never a 500 (Task 5).
- A user who is disabled or deleted after being put on an event: the event still lists, and the user can no longer be added to events (Task 5).
- A plain user who is not on an event edits or deletes it: `403`; an unknown event id: `404`; a non-creator, non-admin on an "everyone" event: `403` (Tasks 4, 5).

---

## Phase A: backend

### Task 1: Repeat rule and series dates

**Files:**
- Create: `backend/app/schedule/__init__.py` (empty), `backend/app/schedule/recurrence.py`
- Modify: `backend/pyproject.toml` (add `python-dateutil>=2.9` to dependencies)
- Test: `backend/tests/test_schedule_recurrence.py`

**Interfaces:**
- Produces:
  - `class NthWeekday(BaseModel)`: `nth: int` (1-5), `day: Literal["MON","TUE","WED","THU","FRI","SAT","SUN"]`
  - `class RecurrenceRule(BaseModel)`: `freq: Literal["daily","weekly","monthly","yearly"]`, `interval: int = 1`, `weekdays: list[Day] = []`, `month_day: int | None = None`, `nth_weekdays: list[NthWeekday] = []`; validation messages follow `Recurrence.parse` in FamillAI (weekly needs weekdays and nothing else; monthly is a day of the month or nth weekdays, not both; daily/yearly take only an interval; nth entries deduplicated and sorted by nth then day)
  - `series_dates(start: date, rule: RecurrenceRule, ends_on: date | None, max_count: int | None, from_: date, to: date) -> list[date]`: dates of the series within `[from_, to]` inclusive, ascending; `max_count` counts from `start` (including cancelled ones, so this function ignores exceptions)
  - `first_date_on_or_after(start: date, rule: RecurrenceRule, day: date) -> date | None`

- [ ] **Step 1: Environment check.** Run `cd backend && .venv/bin/pytest -q tests/test_health.py`. If there is no venv or the database variables are unset, follow `CLAUDE.md` ("Set up the backend once") and `docs/operations.md`; tests skip without `TEST_DATABASE_URL`/`TEST_APP_DATABASE_URL`, and a skipped suite is not a pass.
- [ ] **Step 2: Write the failing parity tests.** Port every case of FamillAI's `OccurrencesTest.java` that concerns rules and series dates (about 25 tests) into `test_schedule_recurrence.py`, keeping its start dates and expected dates verbatim as fixtures. Add: `test_monthly_31st_skips_short_months` (start 2026-01-31, monthly `month_day=31`, expects Jan 31, Mar 31, May 31 in range Jan-Jun), `test_fifth_saturday_skips_months_without_one`, `test_first_and_third_saturday`, `test_max_count_counts_from_start`, `test_weekly_rule_without_weekdays_is_rejected`, `test_monthly_rule_with_both_day_and_nth_is_rejected`, `test_interval_100_is_rejected`.
- [ ] **Step 3: Run to verify they fail** (`ModuleNotFoundError`): `cd backend && .venv/bin/pytest -q tests/test_schedule_recurrence.py`.
- [ ] **Step 4: Implement** the models and functions in `recurrence.py`. Convert the rule to a `dateutil.rrule.rrule` (`BYDAY` with `+nth` for nth weekdays, `BYMONTHDAY`, `INTERVAL`, `UNTIL`, `COUNT`) anchored at `start`; weekly rules with `interval > 1` anchor weeks at `start`'s week (`wkst=MO`, as FamillAI does). Where `rrule` and a FamillAI expected date disagree, the FamillAI date wins: adjust, and if that needs more than a few lines of special-casing, stop and replace `series_dates` with a direct translation of `Occurrences.seriesDates` (the spec's fallback, approach 2).
- [ ] **Step 5: Run the tests to verify they pass**, then run `scripts/audit-deps.sh` and confirm `python-dateutil` is clean.
- [ ] **Step 6: Commit** `backend/pyproject.toml`, `backend/app/schedule/`, the test file: `feat(schedule): repeat rules and series dates`.

### Task 2: Occurrence expansion with exceptions

**Files:**
- Create: `backend/app/schedule/occurrences.py`
- Test: `backend/tests/test_schedule_occurrences.py`

**Interfaces:**
- Consumes: `RecurrenceRule`, `series_dates` (Task 1)
- Produces:
  - `@dataclass(frozen=True) class EventData`: `id: int, title: str, notes: str | None, icon: str | None, color: str | None, all_day: bool, start_date: date, start_time: time | None, duration_minutes: int | None, rule: RecurrenceRule | None, ends_on: date | None, max_count: int | None`
  - `@dataclass(frozen=True) class ExceptionData`: `original_date: date, cancelled: bool, title, notes, start_date, start_time, duration_minutes` (the last five optional)
  - `@dataclass(frozen=True) class Occurrence`: `event_id, original_date, date, start_time, end_time: time | None, all_day, title, notes, repeating: bool, modified: bool`
  - `MAX_RANGE_DAYS = 400`, `DEFAULT_DURATION_MINUTES = 60`
  - `expand(event: EventData, exceptions: list[ExceptionData], from_: date, to: date) -> list[Occurrence]`: sorted by date then start time (all-day first); cancelled dropped; a modified occurrence appears at its new date even when its original date is outside the range; end time capped at 23:59; raises `ValueError` when `to < from_` or the range exceeds 400 days

- [ ] **Step 1: Write failing tests** by porting the expansion cases of `OccurrencesTest.java` (cancel, move into and out of range, override title and time, all-day first, end-of-day cap), plus `test_series_keeps_wall_clock_across_dst` (a weekly 18:00 event over 2026-03-08 stays 18:00 on 03-05 and 03-12) and `test_range_over_400_days_raises`.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement `expand`**, pure (no database, no clock, no time zone conversion).
- [ ] **Step 4: Run to verify they pass.**
- [ ] **Step 5: Commit:** `feat(schedule): expand events into occurrences`.

### Task 3: Migration 0006, models, grants

**Files:**
- Create: `backend/alembic/versions/0006_schedule.py`
- Modify: `backend/app/models.py`, `backend/tests/conftest.py` (add the five new tables to the `TRUNCATE` in `clean_db`)
- Test: `backend/tests/test_schema_schedule.py`

**Interfaces:**
- Produces tables (spec "Data"): `events(id bigint identity, title, notes, icon, color, all_day, start_date, start_time, duration_minutes, recurrence jsonb, ends_on, max_count, created_by bigint FK users, created_at, updated_by FK users, updated_at)`, `event_people(event_id FK cascade, user_id FK, PK both)`, `event_exceptions(event_id FK cascade, original_date, cancelled, title, notes, start_date, start_time, duration_minutes, PK event_id+original_date)`, `event_reminders(id identity, event_id FK cascade, amount, unit)`, `reminder_dismissals(user_id FK, event_id FK cascade, occurrence_date, dismissed_at, PK user_id+event_id+occurrence_date)`; the check constraints of FamillAI's `V12__schedule.sql` (title not blank, timed vs all-day, duration, color list, end rule, end needs recurrence, max_count, reminder unit and amount, exception duration). ORM classes `Event`, `EventPerson`, `EventException`, `EventReminder`, `ReminderDismissal`.

- [ ] **Step 1: Write failing tests** in `test_schema_schedule.py` using `owner_engine` and `app_engine`: `test_app_role_has_full_dml_on_schedule_tables`; `test_timed_event_needs_start_time`; `test_all_day_event_rejects_start_time`; `test_end_rule_not_both`; `test_end_rule_needs_recurrence`; `test_color_must_be_in_palette`; `test_deleting_event_cascades_people_exceptions_reminders`; `test_reminder_unit_check`.
- [ ] **Step 2: Run to verify they fail** (tables missing).
- [ ] **Step 3: Write `0006_schedule.py`** (`revision = "0006"`, `down_revision = "0005"`) as explicit SQL in the style of `0005_user_name.py`, with the `GRANT SELECT, INSERT, UPDATE, DELETE ... TO kmk_app` as in `0004_mfa.py` (identity sequences need `GRANT USAGE ON SEQUENCE` for `kmk_app`; check how `0002` handled `users`); add the ORM classes in `models.py`.
- [ ] **Step 4: Run to verify they pass**, and the whole suite: `cd backend && .venv/bin/pytest -q`.
- [ ] **Step 5: Commit:** `feat(schedule): migration 0006 and models`.

### Task 4: Event authority in policy.py

**Files:**
- Modify: `backend/app/auth/policy.py`
- Test: `backend/tests/test_policy.py` (add cases)

**Interfaces:**
- Produces: `can_change_event(actor: User, creator_id: int, person_ids: frozenset[int]) -> bool` and `check_event(actor: User, creator_id: int, person_ids: frozenset[int]) -> None` (raises `ApiError(403, "forbidden")`). Rule (spec): admins and the super admin always; the creator; a listed person; for an event with no people only the creator or an admin.

- [ ] **Step 1: Write failing tests:** `test_creator_may_change_event`, `test_listed_person_may_change_event`, `test_unlisted_plain_user_may_not`, `test_admin_may_change_any_event`, `test_everyone_event_only_creator_or_admin` (a plain user who is not the creator gets `False`).
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** both functions in `policy.py` (pure, no database).
- [ ] **Step 4: Run `tests/test_policy.py` to verify it passes.**
- [ ] **Step 5: Commit:** `feat(schedule): event authority rules`.

### Task 5: Events API (list, create, change, delete, people)

**Files:**
- Create: `backend/app/schedule/service.py`, `backend/app/schedule/routes.py`
- Modify: `backend/app/main.py` (include the router), `backend/tests/test_mfa_guard.py` only if its route list needs entries (it must not need public-route changes)
- Test: `backend/tests/test_schedule_api.py`

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces (router `prefix="/api/schedule"`, every route `Depends(guard())`):
  - `GET /events?from=YYYY-MM-DD&to=YYYY-MM-DD&q=&people=1,2` returns `{"occurrences": [{event_id, original_date, date, start_time, end_time, all_day, title, notes, icon, color, repeating, modified, people: [user_id...], created_by}]}`; `color` is resolved (explicit, else the avatar color of the lowest-id listed person, else `teal`); `people` empty means everyone; `q` matches title, notes and listed names case- and accent-insensitively (2+ characters); `people` keeps events that include any of the ids or are for everyone
  - `GET /events/{id}` returns the event (rule, ends_on, max_count, people, reminders, exceptions)
  - `POST /events` body `{title, notes, icon, color, all_day, start_date, start_time, duration_minutes, recurrence, ends_on, max_count, people: [int], reminders: [{amount, unit}]}` returns `201` with the event; a repeating event's first date moves to the first date its rule produces on or after it
  - `PATCH /events/{id}` same body plus `scope: "this"|"following"|"all"` and `occurrence_date`; `DELETE /events/{id}?scope=&occurrence_date=`; semantics mirror `EventService.update`/`delete` (a one-off or first-occurrence `following` behaves as `all`; `this` may only change title, notes, date, time and length, otherwise `422 series_field_changed`; `following` ends the old series the day before and creates a new series from that date with the remaining `max_count`)
  - `GET /people` returns `[{id, name, color}]` of users with status `active` (name falls back to username; `color` = `PALETTE[id % 8]`)
  - Error codes: `not_found` 404, `forbidden` 403, `range_too_large` and `bad_range` 422, `series_field_changed` 422, `unknown_person` 422 (person not active), `too_many_reminders` 422, `no_occurrence` 422
  - Audit actions: `event_created`, `event_updated`, `event_deleted`, details `{event_id, scope, fields}`.
  - `PALETTE: tuple[str, ...]` in `service.py`, the 8 event colors in the constraint's order.

- [ ] **Step 1: Write failing tests** (fixtures `client`, `add_user`, `login` from `conftest.py`/`helpers.py`; mutating calls send `ORIGIN` and `X-CSRF-Token`): `test_list_returns_only_range`, `test_everyone_event_has_empty_people`, `test_color_resolved_from_lowest_person_id`, `test_create_event_audited_without_notes_text`, `test_create_repeating_moves_first_date_to_rule`, `test_range_over_400_days_is_422`, `test_to_before_from_is_422`, `test_unlisted_plain_user_cannot_patch_or_delete` (403), `test_unknown_event_is_404`, `test_everyone_event_non_creator_plain_user_is_403`, `test_admin_can_change_any_event`, `test_cannot_add_disabled_user` (`unknown_person`), `test_event_of_disabled_user_still_lists`, `test_this_scope_cancels_one_occurrence`, `test_this_scope_rejects_people_change`, `test_following_splits_series_and_keeps_remaining_count`, `test_search_ignores_case_and_accents`, `test_eleven_reminders_rejected`, `test_people_lists_active_users_only`. Also run `tests/test_mfa_guard.py` and confirm the new routes are covered (it must pass).
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** `service.py` (queries with `Session`, no audit of notes; the audit calls happen in the same transaction as the change, then commit, as `admin.py` does) and `routes.py` (pydantic bodies following `admin.py`'s style), and include the router in `main.py`. Read `app/auth/admin.py` for transaction and `request_ip` usage.
- [ ] **Step 4: Run** `cd backend && .venv/bin/pytest -q` to verify everything passes.
- [ ] **Step 5: Commit:** `feat(schedule): events API`.

### Task 6: Reminders API

**Files:**
- Modify: `backend/app/schedule/service.py`, `backend/app/schedule/routes.py`
- Test: `backend/tests/test_schedule_reminders.py`

**Interfaces:**
- Produces: `GET /api/schedule/reminders/due` returns `{"reminders": [{event_id, occurrence_date, title, start_date, start_time, all_day, remind_at}]}` for the signed-in user (events they are on, or "everyone" events), where `remind_at = start - (amount unit)` on the `America/Toronto` wall clock has passed, the occurrence has not started more than 1 day ago, and no dismissal exists; `POST /api/schedule/reminders/dismiss` body `{event_id, occurrence_date}` returns `204`, idempotent. The function `now_toronto() -> datetime` in `service.py` is the clock the tests patch.

- [ ] **Step 1: Write failing tests:** `test_due_when_two_hours_before`, `test_not_due_earlier`, `test_everyone_event_reminds_every_user`, `test_other_users_event_not_listed`, `test_dismiss_hides_only_for_that_user`, `test_dismiss_is_idempotent`, `test_all_day_reminder_uses_midnight_of_start_date`.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** the two endpoints using `occurrences.expand` over `[today - 1 day, today + 30 days]`.
- [ ] **Step 4: Run the full backend suite.**
- [ ] **Step 5: Commit:** `feat(schedule): reminders API`.

---

## Phase B: front end

Conventions for every front-end task: work in `/home/user/kmk/frontend`; run `npx vitest run` and `npm run build` before each commit; port from the FamillAI file named in the task (read it, copy the logic and its tests, adapt imports); replace `@/api/types` with `frontend/src/schedule/types.ts`, and `@/components/*` with the primitives from Task 8. Add strings to all three locale files.

### Task 7: React Router and TanStack Query under the existing app

**Files:**
- Modify: `frontend/package.json`, `frontend/src/main.tsx`, `frontend/src/App.tsx`, `frontend/src/route.ts`, tests that use `window.location` (`App.test.tsx`, `Shell.test.tsx`, `Account.test.tsx`, `Admin.test.tsx`, `Mfa.test.tsx`, `Language.test.tsx`)
- Create: `frontend/src/queryClient.ts`
- Test: the existing suite

**Interfaces:**
- Produces: the app wrapped in `<BrowserRouter>` (`react-router`) and `<QueryClientProvider>`; `useRoute()` keeps its signature `{ path, navigate }` but is implemented with `useLocation`/`useNavigate`, so existing pages are unchanged; `consumeToken`/`linkLanguage` keep working (the `#token` fragment is still read once and removed with `history.replaceState`); `export function renderWithProviders(ui, { route }): RenderResult` in `frontend/src/testUtils.tsx` (MemoryRouter and a fresh `QueryClient` with retries off).

- [ ] **Step 1: Run the existing frontend suite** and record that it passes: `npx vitest run`.
- [ ] **Step 2: Install** `react-router` and `@tanstack/react-query` at the exact versions FamillAI pins (`/home/user/famillai/ui/package.json`).
- [ ] **Step 3: Adapt the tests** to render through `renderWithProviders` (a test that sets `window.history.pushState` keeps working under `BrowserRouter`; prefer `MemoryRouter` with `route`). They must fail on the missing `testUtils` first.
- [ ] **Step 4: Implement** the wrapping, `useRoute` over the router, and `testUtils.tsx`.
- [ ] **Step 5: Run** `npx vitest run && npm run build`: the same tests as in Step 1 pass.
- [ ] **Step 6: Commit:** `refactor(frontend): React Router and TanStack Query`.

### Task 8: UI primitives and avatars

**Files:**
- Create: `frontend/src/ui/{Button,Dialog,Field,Toggle,Segmented,ChoiceChips,Toast}.tsx`, `frontend/src/ui/Avatar.tsx`, `frontend/src/ui/AvatarGroup.tsx`, `frontend/src/ui/memberColor.ts`, `frontend/src/ui/ui.css` (imported from `main.tsx`)
- Test: `frontend/src/ui/Avatar.test.tsx`, `frontend/src/ui/AvatarGroup.test.tsx`

**Interfaces:**
- Produces:
  - `export const EVENT_COLORS: readonly ["red","orange","amber","green","teal","blue","violet","pink"]`; `memberColor(userId: number): EventColor` (`EVENT_COLORS[userId % 8]`); `eventColorVar(color: EventColor): string` returning a CSS variable name defined in `ui.css` for light and dark
  - `Avatar({ person: Person, size?: "sm"|"md"|"lg", muted?: boolean })` renders a circle with initials (first letters of up to two name words, uppercased) in the person's color; `AvatarGroup({ people: Person[], everyone: boolean, max?: number })` overlaps faces, shows `+N`, and shows a people icon for everyone
  - `type Person = { id: number; name: string; color: EventColor }`
  - The other primitives port the props FamillAI's schedule code uses (read how each is called there); `Dialog` traps focus and closes on Escape.

- [ ] **Step 1: Write failing tests:** `Avatar shows two initials`, `Avatar uses one initial for a one-word name`, `Avatar is muted when muted`, `AvatarGroup shows +N beyond max`, `AvatarGroup shows the people icon for everyone`, `memberColor is stable and in the palette`.
- [ ] **Step 2: Run to verify they fail:** `npx vitest run src/ui`.
- [ ] **Step 3: Implement** the primitives, with colors only from `index.css` tokens plus the 8 event color variables (tuned so teal stays distinct from `--pine`; each has a light and a dark value).
- [ ] **Step 4: Run to verify they pass.**
- [ ] **Step 5: Commit:** `feat(frontend): shared UI primitives and avatars`.

### Task 9: App layout (side rail, bottom bar, account menu)

**Files:**
- Create: `frontend/src/app/Layout.tsx`, `frontend/src/app/Nav.tsx`, `frontend/src/app/AccountMenu.tsx`, `frontend/src/app/layout.css`
- Modify: `frontend/src/Shell.tsx` (becomes a thin wrapper around `Layout`), `frontend/src/index.css` (the centered-card `body` rules apply only to card pages; signed-in pages use the new layout), `frontend/src/Shell.test.tsx`
- Port from: FamillAI `ui/src/app/Nav.tsx`, `navFit.ts`, `MoreSheet.tsx` (keep only what three or four items need; skip the adaptive "More" tab unless the items overflow)

**Interfaces:**
- Produces: `Layout({ user: User, csrfToken: string, onLanguageChanged, onSignOut, children })`; `Nav({ items: NavItem[] })` with `type NavItem = { to: string; labelKey: string; icon: ReactNode; adminOnly?: boolean }`; items: Dashboard `/`, Schedule `/schedule`, Users `/admin` (admins and the super admin only). Below 768px a fixed bottom bar; from 768px a side rail; page width up to 1400px from 768px. The account menu opens from the user's avatar and holds Account (`/account`), the language switcher and Sign out.

- [ ] **Step 1: Write failing tests** in `Shell.test.tsx`: `shows Dashboard and Schedule to a plain user`, `shows Users only to admins`, `account menu holds account, language and sign out`, `marks the current page`.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** the layout; port the responsive CSS rules from FamillAI (side rail from 768px, bottom bar under it) onto KMK tokens (pine active item, mist hover, deep and spark in dark mode). Keep the skip link and the logo.
- [ ] **Step 4: Run** `npx vitest run && npm run build`; then open the app at 360px, 820px and 1280px wide with Playwright and look at screenshots of each (see the `run` skill).
- [ ] **Step 5: Commit:** `feat(frontend): FamillAI-style layout in KMK colors`.

### Task 10: Schedule data layer and pure modules

**Files:**
- Create: `frontend/src/schedule/types.ts`, `api.ts`, `hooks.ts`, `scheduleDates.ts`, `gridLayout.ts`, `eventForm.ts`, `scheduleView.ts`, `dragMove.ts`
- Test: `frontend/src/schedule/{scheduleDates,gridLayout,eventForm,scheduleView,dragMove}.test.ts`, `hooks.test.tsx`
- Port from: FamillAI `scheduleDates.ts`, `gridLayout.ts`, `eventForm.ts`, `scheduleView.ts`, `dragMove.ts` and their tests, unchanged in behavior

**Interfaces:**
- Produces:
  - `types.ts`: `Occurrence` (fields as in Task 5's list response), `EventDetail`, `EventInput`, `RecurrenceRule` (`{freq, interval, weekdays, month_day, nth_weekdays}` as in the API), `Scope = "this"|"following"|"all"`
  - `api.ts`: `listOccurrences(from: string, to: string, opts?: { q?: string; people?: number[] }): Promise<Occurrence[]>`, `getEvent(id)`, `createEvent(input, csrf)`, `updateEvent(id, input, scope, occurrenceDate, csrf)`, `deleteEvent(id, scope, occurrenceDate, csrf)`, `listPeople()`, `dueReminders()`, `dismissReminder(eventId, occurrenceDate, csrf)`; errors surface the `{"error": code}` body as `ApiFailure` with `.code`
  - `hooks.ts`: `useOccurrences(from, to, opts)`, `usePeople()`, `useEvent(id)`, `useSaveEvent()`, `useDeleteEvent()`, `useDueReminders()` (refetch every 60 s), `useDismissReminder()`; mutations invalidate the occurrences and reminders queries; query keys in one `keys` object
  - the pure modules keep FamillAI's exported names (read them) except that day-start/end hours come from constants `WEEKDAY_HOURS = [7, 20]`, `WEEKEND_HOURS = [8, 20]` instead of family settings

- [ ] **Step 1: Port the tests of the five pure modules** (they define behavior) and write `hooks.test.tsx`: `useOccurrences fetches the range`, `saving an event refetches occurrences`, `an error code reaches the caller`.
- [ ] **Step 2: Run to verify they fail:** `npx vitest run src/schedule`.
- [ ] **Step 3: Implement** the modules and API/hook layer (`fetch` with `credentials: "same-origin"` and the `X-CSRF-Token` header as `src/api.ts` does).
- [ ] **Step 4: Run to verify they pass.**
- [ ] **Step 5: Commit:** `feat(schedule): front-end data layer`.

### Task 11: Schedule page, views and toolbar

**Files:**
- Create: `frontend/src/schedule/{SchedulePage,ScheduleToolbar,TimeGrid,MonthView,YearView,ScheduleChip}.tsx`, `schedule.css`
- Modify: `frontend/src/App.tsx` (route `/schedule`), `frontend/src/locales/*.json`
- Test: `SchedulePage.test.tsx`, `TimeGrid.test.tsx`, `MonthView.test.tsx`, `YearView.test.tsx`
- Port from: the FamillAI files of the same names (drop assistant, settings dialog, offline note and task rows)

**Interfaces:**
- Consumes: Tasks 8-10.
- Produces: `SchedulePage()` reading `?view=day|week|month|year&date=YYYY-MM-DD` from the URL; toolbar with the Day/Week/Month/Year switch, today and previous/next, a people filter built from `AvatarGroup` faces (tap to toggle, `+N` opens a checkbox list), and a magnifier opening the search box (results list from `listOccurrences(..., { q })`); `onOpenEvent(occurrence)` and `onCreate(date, time?)` callbacks opened by Task 12's dialog.

- [ ] **Step 1: Port the four view tests** and the page test (view switching, previous/next, today, people filter, search results, opening an event); adapt to the KMK API layer with `renderWithProviders` and a mocked `fetch`.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** the page and views; the grid emphasizes the constants from Task 10; add the nav label strings.
- [ ] **Step 4: Run** `npx vitest run && npm run build`, then check 360, 820 and 1280 px screenshots of Day, Week, Month and Year.
- [ ] **Step 5: Commit:** `feat(schedule): schedule page and views`.

### Task 12: Event dialog, repeat fields, reminders, scope choice

**Files:**
- Create: `frontend/src/schedule/{EventDialog,RecurrenceFields,ReminderFields,ScopeChoice,PeoplePicker,IconPicker}.tsx`
- Modify: `SchedulePage.tsx` (open the dialog), locale files
- Test: `EventDialog.test.tsx`, `RecurrenceFields.test.tsx`, `ScopeChoice.test.tsx`
- Port from: FamillAI `EventDialog.tsx`, `RecurrenceFields.tsx`, `ReminderFields.tsx`, `ScopeChoice.tsx`; `IconPicker` is a fixed list of about 30 emoji (FamillAI's custom-icon store is out of scope)

**Interfaces:**
- Produces: `EventDialog({ mode: "create"|"edit", occurrence?, initial?, onClose })`; `PeoplePicker({ value: number[], everyone: boolean, onChange })` (faces in a row, "Everyone" first, `+N` on phones); `ScopeChoice({ onChoose(scope: Scope) })` shown before saving or deleting a repeating event; the dialog hides Save and Delete when the user may not change the event (rule from `can_change_event` mirrored in `canChangeEvent(user, event): boolean` in `schedule/permissions.ts`; the server remains the authority).

- [ ] **Step 1: Port the dialog tests** (create one-off, create weekly on chosen weekdays, "4th Saturday", end after N, up to 10 reminders and the 11th refused, edit asks scope for a repeating event, `series_field_changed` message shown) and write `permissions.test.ts`: `creator may change`, `listed person may change`, `unlisted plain user may not`, `admin may change anything`, `everyone event: creator or admin only`.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** the dialog and fields; show error codes through locale keys `errors.<code>`.
- [ ] **Step 4: Run** `npx vitest run && npm run build`.
- [ ] **Step 5: Commit:** `feat(schedule): event dialog with repeats and reminders`.

### Task 13: Drag to move, resize, Undo, swipe

**Files:**
- Create: `frontend/src/schedule/{useMoveEvent,useSwipe}.tsx`
- Modify: `TimeGrid.tsx`
- Test: `dragMove.test.ts` (extend), `useSwipe.test.tsx`, `TimeGrid.test.tsx` (extend)
- Port from: FamillAI `useMoveEvent.tsx`, `useSwipe.ts`, `dragMove.ts`, TimeGrid drag handlers

**Interfaces:**
- Produces: dragging an event in Day and Week snaps to 15 minutes with a preview; dragging its bottom edge changes the duration; a one-off move shows a toast with Undo (which sends the old values); a repeating event asks `ScopeChoice` first; on touch screens a press and hold of about 300 ms starts the drag so scrolling still works; swipe left/right changes the day or week.

- [ ] **Step 1: Write failing tests:** `snaps to a quarter of an hour`, `resize cannot go below 15 minutes`, `move across midnight is refused for timed events`, `a repeating move asks scope`, `undo restores the previous time`, `a quick tap still opens the event`.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** by porting the FamillAI hooks.
- [ ] **Step 4: Run** `npx vitest run`; in Playwright, drag an event on a 1280 px window and a touch-emulated 820 px window and look at the result.
- [ ] **Step 5: Commit:** `feat(schedule): drag to move and resize`.

### Task 14: Reminder tray

**Files:**
- Create: `frontend/src/schedule/ReminderTray.tsx`
- Modify: `frontend/src/app/Layout.tsx` (mount the tray for signed-in users), locale files
- Test: `ReminderTray.test.tsx`
- Port from: FamillAI `ReminderTray.tsx`

**Interfaces:**
- Consumes: `useDueReminders`, `useDismissReminder` (Task 10).
- Produces: `ReminderTray()` showing one card per due reminder with the event title and time and a Dismiss button; it renders nothing when there are none; an error from the API never blocks the page.

- [ ] **Step 1: Port the tray tests** plus `renders nothing when empty` and `a failed poll shows nothing and keeps the app usable`.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run && npm run build`.
- [ ] **Step 5: Commit:** `feat(schedule): on-screen reminders`.

### Task 15: Dashboard and removal of Welcome

**Files:**
- Create: `frontend/src/dashboard/{DashboardPage,MyEventsCard,AllEventsCard,EventRow}.tsx`, `dashboard.css`, `groupByPerson.ts`
- Modify: `frontend/src/App.tsx` (`/` renders the Dashboard), `frontend/src/Shell.test.tsx`, `App.test.tsx`, locale files (remove `welcome*` keys)
- Delete: `frontend/src/WelcomePage.tsx`, `welcomeContent.ts`, `Welcome.test.tsx`
- Test: `DashboardPage.test.tsx`, `groupByPerson.test.ts`

**Interfaces:**
- Consumes: `useOccurrences`, `usePeople`.
- Produces:
  - `groupByPerson(occurrences: Occurrence[], people: Person[]): { everyone: Occurrence[]; byPerson: { person: Person; occurrences: Occurrence[] }[] }` (an event for several people appears under each of them; events with no people go to `everyone`; people with no events are omitted; groups ordered by name; occurrences by date then time)
  - `MyEventsCard()`: today and the next 7 days, events the signed-in user is on plus "everyone" events, split into "Today" and "Upcoming"
  - `AllEventsCard()`: the same range for everyone, an "Everyone" group first then one group per person with their `Avatar`
  - Rows show time (or "All day"), icon, title and `AvatarGroup`; clicking one goes to `/schedule?view=day&date=<date>`; each card header links to `/schedule`; empty states are translated. Cards sit side by side from 768px and stack on a phone.

- [ ] **Step 1: Write failing tests:** `groupByPerson puts an event under each listed person`, `groupByPerson puts everyone events in their own group`, `groupByPerson omits people without events`, `My events includes everyone events`, `My events splits today and upcoming`, `All events shows the Everyone group first`, `empty state when nothing is planned`, `row click goes to the day`.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** the page and cards; remove the Welcome files and keys; `/` for a signed-in user renders the Dashboard.
- [ ] **Step 4: Run** `npx vitest run && npm run build`; the locale key-set test passes.
- [ ] **Step 5: Commit:** `feat(dashboard): My events and All events widgets, replacing Welcome`.

### Task 16: Documentation, security notes, end-to-end check

**Files:**
- Modify: `docs/README.md` (status table, data model, API table, routes, "Adding content to the Welcome page" paragraph removed), `docs/security.md` (event visibility accepted risk; event authority rules), `docs/roadmap.md`, `docs/operations.md` (new dependency, nothing to configure), `CLAUDE.md` (migrations `0001` to `0006`, new layout lines for `app/schedule/` and the front-end folders)
- Test: manual end-to-end check

**Interfaces:** none.

- [ ] **Step 1: Update the docs** as listed above; record `python-dateutil`, `react-router`, `@tanstack/react-query` in `docs/decisions.md` with the reason (FamillAI parity; the fallback to a hand-written repeat engine).
- [ ] **Step 2: Run everything:** `cd backend && .venv/bin/pytest -q`, `cd frontend && npx vitest run && npm run build`, `scripts/audit-deps.sh`.
- [ ] **Step 3: Run the stack** (build the front end first, then `cd deploy && docker compose up -d --build`) or the dev servers, and with Playwright walk through: sign in, create a one-off and a weekly event for two people, see both in the Dashboard widgets, drag one, delete "this event" of the series, and check 360, 820 and 1280 px. Report what passed and what was not exercised.
- [ ] **Step 4: Commit:** `docs: schedule and dashboard`.

---

## Self-review

- **Spec coverage:** goals map to Tasks 1-2 (repeats), 3 (data), 5 (events, search, people filter, scopes), 6-7 and 14 (reminders; routing), 8-9 (layout, avatars, colors), 10-13 (views, dialog, drag), 15 (Dashboard widgets, Welcome removal), 16 (docs, accepted-risk note). The spec's non-goals appear in no task.
- **Types:** `RecurrenceRule` (Task 1) is reused in Tasks 2 and 5 and mirrored in `types.ts` (Task 10); `PALETTE`/`EVENT_COLORS`/`memberColor` use the same order (`id % 8`) in Tasks 5 and 8; `Scope` is the same three values in Tasks 5, 10 and 12; `Person`/`Occurrence` (Tasks 8 and 10) feed `groupByPerson` (Task 15).
- **Open risks to watch:** `rrule` versus FamillAI edge dates (Task 1 fallback); the routing change breaking existing tests (Task 7 runs the suite before and after).
