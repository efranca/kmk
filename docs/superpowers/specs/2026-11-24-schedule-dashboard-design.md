# Schedule and Dashboard (design)

Date: 2026-11-24. Status: draft, waiting for the owner's approval. Nothing is built yet.

## Intent and why

**Asked for:** KMK gets a shared Schedule (a calendar) that works and feels like the one in FamillAI, and a Dashboard
home page with two widgets. It must work on phone, tablet and desktop, and use KMK's colors.

**Why (not stated by the owner, so an assumption):** the ~15 employees and admins can see who is doing what and when.
The owner did not describe the daily use; if it is mainly about client visits, the design still holds (events carry
a title, notes, people and a repeat rule), but nothing here is built specifically for cleaning jobs.

## Goals

- A shared calendar with Day, Week, Month and Year views, for all KMK users, on phone, tablet and desktop.
- Events with a title, notes, an icon, one of 8 colors, all-day or timed (start and duration), and one or more
  people (no people = everyone).
- Repeating events: daily, weekly (chosen weekdays), monthly (a day of the month, or "the 4th Saturday", "the 1st and
  3rd Saturday"), yearly; every N of each; ending on a date or after N times.
- Changing or deleting a repeating event asks: this event, this and the following, or all events.
- Drag an event to move it, drag its bottom edge to resize it (15-minute snap, preview, Undo for a one-off event).
- Up to 10 on-screen reminders per event ("2 hours before", "1 day before").
- Search events by keyword; filter by people (avatars, "+N").
- Dashboard (the new home page) with two widgets:
  - **My events:** events I am on (including "everyone" events), today and the next 7 days.
  - **All events:** everyone's events, today and the next 7 days, grouped by person.
- FamillAI's layout structure with KMK's colors (below), every string in fr-CA, en and pt-BR.

## Non-goals and anti-goals

- No Tasks, no Shopping, no expenses, recipes, documents, bank, XP or anything about children.
- No AI assistant, no voice, no weather, no phone push notifications, no event categories, no photo avatars.
- No schedule settings screen (hours and time zone are constants) and no automatic theme schedule.
- **FamillAI is never modified.** It is read as a reference only.
- Anti-goal: weakening KMK's security rules (guard on every route, audit log, three locales) to copy FamillAI faster.

## Decisions by the owner

1. Scope: Schedule + Dashboard only. Tasks and Shopping dropped.
2. Everyone sees everyone's events in full (visibility option 1).
3. Two widgets, both reading the calendar: **My events** and **All events**.
4. "Recurring types" means the repeat options daily, weekly, monthly, yearly.
5. Approach 1: port FamillAI's screens into KMK, restyled, with a new Python backend (see Approaches).

## Constraints

- KMK's conventions in `CLAUDE.md` apply: `Depends(guard())` on every route (and `tests/test_mfa_guard.py` must list
  the new routes), authority rules in `app/auth/policy.py`, audit rows through `audit.log(...)` (plain INSERT), hand-written
  Alembic migration with `app/models.py` kept in step, tests first, `kmk_app` runtime role grants, new compose
  settings listed in `api.environment`, docs kept accurate.
- Stack stays: FastAPI, SQLAlchemy 2, Alembic, PostgreSQL, React 19 + Vite.
- Event details are visible to every signed-in user (decision 2). This is an accepted risk to record in `docs/security.md`:
  titles and notes must not hold anything an employee should not see.

## Approaches considered

1. **Port the screens, write a new Python backend (chosen).** Copy FamillAI's schedule components into KMK, restyle
   them on KMK's tokens, add TanStack Query and React Router (FamillAI's code uses both), and write a FastAPI module.
   Repeat dates come from `python-dateutil`'s `rrule`. Trade-off: two new frontend libraries and a routing change under
   existing pages.
2. **Same port, but translate FamillAI's Java repeat engine line by line.** Identical edge-case behavior. The engine
   is small (about 350 lines in `Recurrence.java` and `Occurrences.java`), so this is the fallback if `rrule` fails
   the parity tests, not the first choice: a maintained library beats a hand-kept engine.
3. **Rebuild from scratch or use a calendar library.** Less copied code, but it would not look or behave like FamillAI.

## Design

### Data (migration `0006_schedule`, written by hand)

Mirrors FamillAI's `V12__schedule.sql` without the family columns. Users are `users.id` (bigint).

- `events`: id, title (1-200), notes, icon, color (one of red, orange, amber, green, teal, blue, violet, pink; null =
  the first listed person's color), all_day, start_date, start_time, duration_minutes (1-1440), recurrence (JSONB, null
  = does not repeat), ends_on, max_count (not both; neither without recurrence), created_by, created_at, updated_by,
  updated_at. Check: timed events have a start time, all-day events do not.
- `event_people` (event_id, user_id): the people an event is for; no rows = everyone.
- `event_exceptions` (event_id, original_date, cancelled, title, notes, start_date, start_time, duration_minutes):
  "this occurrence only" changes.
- `event_reminders` (event_id, amount 1-99, unit hours/days/weeks); at most 10 per event (service rule).
- `reminder_dismissals` (user_id, event_id, occurrence_date).
- Dates and times are local wall-clock values in one company time zone, `America/Toronto` (constant). Nothing converts
  time zones, so "Thursday 18:00" stays 18:00 across daylight saving.
- Repeating events are stored as one row and expanded when read, for the requested range only (at most 400 days).
- Grants: `kmk_app` gets the usual table rights; the audit log stays INSERT only.

### Repeat rule

The API keeps FamillAI's JSON shape: `{"freq":"daily|weekly|monthly|yearly","interval":1,"weekdays":["THU"],
"month_day":null,"nth_weekdays":[{"nth":4,"day":"SAT"}]}` with FamillAI's validation (interval 1-99, a weekly rule
needs weekdays, a monthly rule is a day of the month or nth weekdays, at most 5 nth weekdays). The Python module
converts it to an `rrule` for expansion. A month without a 5th Saturday has no occurrence. The count of a series
includes cancelled occurrences, counted from the series start.

The parity suite: the cases of FamillAI's own `Occurrences` tests (if present) are re-written as Python tests using
FamillAI's expected dates as fixtures. FamillAI's files are only read.

### API (all under `/api/schedule`, all `Depends(guard())`)

- `GET /events?from&to&q&people` expanded occurrences in a range (at most 400 days), search by keyword.
- `POST /events`, `PATCH /events/{id}`, `DELETE /events/{id}` with `scope` = `this` | `following` | `all` and the
  occurrence date for repeating events.
- `GET /people` selectable users (active ones: id, display name, avatar color).
- `GET /reminders/due` and `POST /reminders/dismiss`.
- The Dashboard reuses `GET /events` for its two date ranges; no separate dashboard endpoint unless profiling asks.
- Errors are `{"error": "<code>"}` like the rest of KMK.

### Who can do what (my call, `policy.py`)

- Any verified user creates events, for themselves or anyone else, or for everyone.
- Edit or delete: the creator, a person the event is for, or any admin or the super admin. "Everyone" events: the
  creator or an admin. This is stricter than FamillAI, where any member changes anything. Reason: with 15 colleagues,
  nobody should move a coworker's appointment by accident.
- Every create, change, delete and "this/following/all" change is written to the audit log, with the event id, the
  scope and the field names that changed, never notes text.
- Disabled or deleted users cannot be added to events. Their existing events stay, shown with a muted avatar.

### Frontend

- Routes: `/` Dashboard, `/schedule`, `/account`, `/admin`; sign-in, recovery and two-step screens keep their card
  look. Navigation moves to React Router; TanStack Query holds server state. The existing screens and tests keep working.
- **Layout (FamillAI's structure):** phone bottom bar (Dashboard, Schedule, plus Users for admins) and an account menu
  behind the avatar (Account, language, sign out); from 768px a side rail and pages up to 1400px wide; touch screens
  behave as phones for the swipe and press-and-hold rules.
- **Colors:** KMK tokens: pine for actions, mist for highlights, paper and white for surfaces, deep and spark in dark mode,
  following the system setting as today. The 8 event colors are chosen to read well on both. Teal must stay distinct from
  the accent.
- **Avatars:** a colored circle with the person's initials; the color is derived from the user id (stable). Overlapping
  faces with "+N" for several people; a people icon for everyone.
- **Dashboard:** My events and All events cards, side by side from 768px and stacked on a phone. Tapping an event opens the
  Schedule at that day; tapping a card header opens the Schedule with that view.
- **Schedule:** Day, Week, Month, Year; toolbar with Day/Week/Month/Year switch, today and previous/next, search (magnifier),
  people filter; time grid emphasising 07:00-20:00 on weekdays and 08:00-20:00 on weekends (constants).
- Every string lives in all three locale files (a test checks the key sets match).

### Docs and operations

`docs/README.md` (status, data model, API, routes), `docs/security.md` (visibility risk, authorization rules),
`docs/roadmap.md`, and `docs/operations.md` are updated in the same change. The new Python dependency (`python-dateutil`)
goes through `scripts/audit-deps.sh`.

## Calls made after the builder check (mine, to be checked by the owner)

- **Dashboard replaces Welcome.** `/` is the Dashboard for every signed-in user. `WelcomePage.tsx`, `welcomeContent.ts`,
  their locale keys and `Welcome.test.tsx` are removed; `App.tsx`, `Shell.tsx` and their tests change accordingly.
- **Access.** Every role, as long as the session is fully verified (`Depends(guard())`). No feature switches.
- **Selectable people.** Users with status `active`, including admins and the super admin. `invited`, `disabled` and
  `deleted` accounts cannot be added to events; their existing events stay, with a muted avatar.
- **"Everyone."** No `event_people` rows means every active user at the time of viewing, so a new employee sees old
  "everyone" events. In the All events widget these appear in their own "Everyone" group at the top, not repeated per person.
  In My events they appear for everyone.
- **Reminders.** The app polls `GET /reminders/due` every 60 seconds while it is open. A reminder goes to the people the
  event is for (all active users for "everyone"). Times are computed on the `America/Toronto` wall clock. Dismissal is per
  user and per occurrence.
- **Routing.** The whole app moves to React Router, including the card pages (sign-in, recovery, two-step), so there is one
  routing mechanism. The existing tests are adapted, not dropped; run them first.
- **Event color.** When the color is null, it is resolved at read time: the avatar color of the listed person with the lowest
  user id, or teal for "everyone". The avatar color is `user id mod 8` into the same 8 colors.
- **Edit rights, in full.** Whoever may edit an event may do everything to it: change details, time and people, and delete a
  series or this-and-following. That is the creator, a listed person, or an admin; for "everyone" events, the creator or an
  admin. The risk: a listed person can delete a whole series someone else made. The audit log records who did it.
- **Migration number.** `0006_schedule` is correct: `0005_user_name.py` exists (CLAUDE.md still says 0001 to 0004).
- **Reference files.** FamillAI's schedule UI is in `/home/user/famillai/ui/src/features/schedule/`, the repeat logic in
  `api/src/main/java/com/famillai/domain/` (`Recurrence.java`, `Occurrences.java`), and the repeat tests in
  `api/src/test/java/com/famillai/unit/OccurrencesTest.java`, which exists and is the parity fixture source.

## Left to the builder

Exact event color values; the order and grouping inside the widgets; empty-state wording; the shape of the
reminder tray; whether the 400-day range needs paging in the Year view; test file layout; how to split the work into
phases (the natural split is: backend and migration, then Schedule screens, then Dashboard and navigation).

## Risks

- The routing change touches every signed-in page: run the full existing frontend suite after it, before any schedule work.
- `rrule` and FamillAI differ in a corner (month-end days such as the 31st, or leap-day yearly events): the parity
  tests decide, and the fallback is approach 2.
- Dragging on touch screens is the hardest interaction to get right; FamillAI uses press-and-hold.
