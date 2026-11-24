# Tasks (design)

Date: 2026-11-24. Status: approved by the owner. Nothing is built yet.

## Intent and why

**Asked for:** KMK gets FamillAI's Tasks feature: a shared to-do list for the team, with categories and a Dashboard
widget, that looks and behaves like FamillAI's. There are no children, no XP or rewards, no AI, and no repeating tasks.

**Why (not stated by the owner, so an assumption):** the team can see who has to do what, and by when, next to the
shared calendar. This reverses an earlier decision: the schedule design dropped Tasks, and `docs/roadmap.md` lists them
as "not built, by choice". The decision log and roadmap are updated to record the change.

## Goals

- A **Tasks page** (`/tasks`, in the navigation between Schedule and Users) that works like FamillAI's:
  - status tabs: To do, Done, All
  - a people filter (the same faces as on Schedule, with "+N" for more; none picked means the whole team)
  - when people are picked, a summary card: their faces, "N to do, M done" and a progress bar
  - category chips with an icon and a count; tapping one filters the list
  - search with the magnifier in the header: it filters the loaded tasks by title, description, category and people,
    ignoring case and accents, and looks through done and to-do tasks together
  - in To do, tasks grouped by when they are due: Overdue, Today, This week, Later, No date
  - "Clear completed" (in Done and All), with a confirmation that gives the count
  - an empty state with "Add the first task"
- **Task rows** as in FamillAI: a checkbox, the icon, the title, the due date, the category as a small round icon, and
  the people as overlapping faces on the right (a people icon for the whole team). Tap the row to edit.
- **The task dialog** (create and edit) uses FamillAI's fields, without reward, repeat or PIN:
  - an icon (emoji picker; for a new task the icon follows the title until one is picked) and a title (1-200)
  - people: the same face picker as for events, with "Everyone" first
  - due date (optional): chips for Today and Tomorrow, plus "Pick a date"
  - a category (a drop-down with icons)
  - a description (optional, up to 2000 characters)
  - "Show on Dashboard" (on by default)
  - created by / changed by lines, and Delete (with a confirmation) when editing
- **Categories**: a gear next to "+" opens the category manager. You can add a category (name 1-50 and an optional
  emoji, suggested from the name until one is picked), rename it, change its icon, or delete it. Deleting a category
  keeps its tasks, which then have no category.
- **Dashboard widget "Tasks"**, a third card next to My events and All events. It works like FamillAI's Home Tasks card,
  minus the children's parts. It shows **my tasks** (owner's decision): tasks I am on, plus whole-team tasks (no
  people). Only tasks with "Show on Dashboard" on are listed:
  - Overdue tasks first
  - then Today: tasks due today that are still to do, then tasks finished today, struck through
  - then No date: undated tasks that are still to do
  - then Tomorrow: tasks due tomorrow
  - Rows can be ticked right there. The card header opens `/tasks`, and a row opens `/tasks`.
  - Each section shows a fixed number of rows (FamillAI: 6 for today, 3 for tomorrow) with "+N more" linking to `/tasks`.
- **Tasks on the Schedule**: a switch in the Schedule toolbar, "Show tasks", off by default and remembered in the browser
  (per person, per device). When it is on, tasks with a due date are shown as all-day task chips on their day in every
  view (Day, Week, Month; dots in Year), in a task style distinct from events. A chip has a checkbox to tick the task and
  opens the task dialog when tapped. The people filter applies to them too.
- Every string is in fr-CA, en and pt-BR.

## Non-goals and anti-goals

- No repeating tasks, no completions per person or per day, no XP, rewards, children, PIN lock or kids' views.
- No AI assistant or voice, no bulk creation endpoint, no `origin` column.
- No uploaded custom icons (emoji only, so no image uploads).
- No phone push or email for tasks, and no reminders on tasks.
- No team-wide settings screen. The Schedule "Show tasks" switch is per browser.
- **FamillAI is never modified.** It is read as a reference only.
- Anti-goal: weakening KMK's security rules (guard on every route, audit log, three locales, the `kmk_app` grants) to
  copy FamillAI faster.

## Decisions by the owner

1. Port the Tasks feature with categories and a Dashboard widget, without children, XP or rewards.
2. No AI for now. It will be its own project later.
3. Approach 1 (port the screens, new Python backend) combined with approach 2 (no repeating tasks).
4. The Dashboard card shows my tasks (tasks I am on and whole-team tasks), not everyone's.

## Constraints

- KMK's `CLAUDE.md` applies in full: `Depends(guard())` on every route, with `tests/test_mfa_guard.py` covering them;
  rules in `app/auth/policy.py`; audit rows through `audit.log(...)` (a plain INSERT); a hand-written Alembic migration
  `0007_tasks` with `app/models.py` kept in step; `kmk_app` grants; test first; error bodies `{"error": "<code>"}`;
  three locale files with matching keys; docs kept accurate.
- Stack: FastAPI, SQLAlchemy 2, Alembic, PostgreSQL, React 19, React Router, TanStack Query (all already in KMK).
  No new dependencies are expected.
- Dates are wall-clock dates in the company time zone (`America/Toronto`), like the schedule. "Today" is
  `todayIn(COMPANY_TIME_ZONE)` on the front end and the same zone on the server.
- Every verified user sees every task in full, as with events. This is an accepted risk added to `docs/security.md`:
  task titles and descriptions must not hold anything an employee should not see.

## Approaches considered

1. **Port the screens, write a new Python backend (chosen, with 2).** FamillAI's task components are copied into KMK's
   `frontend/src/tasks/`, built on KMK's existing `ui/` pieces (Avatar, AvatarFilter, Dialog, IconPicker, ChoiceChips,
   Segmented, PageHeader, Feedback) and KMK's colors. A new `backend/app/tasks/` module sits beside `schedule/`. This
   is the pattern already used for the Schedule. Trade-off: the most work, but it looks and behaves the same.
2. **No repeating tasks (chosen, combined with 1).** A task is either to do or done. There is no completions table and
   no `/today` endpoint. This cuts about a third of FamillAI's task backend (`TaskCompletionService`,
   `TaskCompletionRepository`, `TaskRepeat`) and the UI's occurrence logic. Trade-off: recurring chores have to be
   created as separate tasks, or as calendar events.
3. **Tasks stored as a kind of calendar event (rejected).** Tasks have a status, categories and a "done" time that
   events don't have, and events repeat while tasks don't. One table would make both harder to keep working.

## Design

### Data (migration `0007_tasks`, written by hand)

- `task_categories`
  - `id` bigserial
  - `name` varchar(50), not blank, unique case-insensitively (a unique index on `lower(name)`)
  - `icon` varchar(32), null or 1-8 characters, one emoji
  - `created_by`, `created_at`, `updated_at`
- `tasks`
  - `id` bigserial
  - `title` varchar(200), not blank
  - `description` text, up to 2000 characters
  - `icon` varchar(32), null or 1-8 characters
  - `category_id`, which references `task_categories` with `ON DELETE SET NULL`
  - `status`: `pending` or `completed`
  - `due_date` date, null allowed
  - `completed_at` timestamptz, set if and only if the status is `completed` (a check constraint)
  - `completed_by` (users, null allowed)
  - `show_on_dashboard` boolean, default true
  - `created_by`, `created_at`, `updated_by`, `updated_at` (all referencing users)
  - Indexes on `(status, due_date)` and on `category_id`.
- `task_people (task_id, user_id)`: the primary key is both columns, and deleting a task deletes its rows. No rows
  means the whole team.
- Grants: `kmk_app` gets SELECT, INSERT, UPDATE, DELETE on the three tables and USAGE on their sequences. The audit
  log stays INSERT only.
- Users are soft-deleted, so the foreign keys to `users` use `ON DELETE RESTRICT`, as the schedule tables do.

### API (all under `/api/tasks`, every route `Depends(guard())`)

| Method and path | Purpose |
| --- | --- |
| `GET /api/tasks?status=pending\|completed\|all&person=<id>\|none` | Pending tasks first, then by due date (no date last), then newest. `person` limits the list to tasks that person is on; `none` limits it to whole-team tasks. At most 1000 rows. |
| `POST /api/tasks` | Create. Body: `title`, `description`, `icon`, `category_id`, `people` (user ids, at most 50), `due_date`, `show_on_dashboard`. Unknown fields are rejected. |
| `GET /api/tasks/{id}` | One task. |
| `PATCH /api/tasks/{id}` | Change any of the create fields. |
| `POST /api/tasks/{id}/complete`, `POST /api/tasks/{id}/reopen` | Change the status. Both are idempotent. |
| `DELETE /api/tasks/{id}` | Delete. |
| `DELETE /api/tasks/completed` | Delete the completed tasks the caller may delete. Returns `{"deleted": n}`. |
| `GET /api/tasks/categories` | List, ordered by name. |
| `POST /api/tasks/categories`, `PATCH /api/tasks/categories/{id}`, `DELETE /api/tasks/categories/{id}` | Manage categories (`name`, `icon`). |

- A task is returned with: `id`, `title`, `description`, `icon`, `category_id`, `people`, `status`, `due_date`,
  `completed_at`, `show_on_dashboard`, `created_by` and `updated_by` (each `{id, name}`), `created_at` and `updated_at`.
- People are taken from `GET /api/schedule/people`, so there is one source of selectable people. Only `active` users
  can be added to a task. Existing links to disabled users stay and are shown with a muted face, as for events.
- Error codes:
  - `task_not_found` (404) and `category_not_found`
  - `category_exists` (409)
  - `person_not_selectable`
  - `forbidden` (403)
  - `validation_error` (422)
- The Schedule's "Show tasks" reuses `GET /api/tasks?status=all` and filters by date on the client. There is no new
  schedule endpoint.

### Who can do what (`policy.py`, mirrored in `frontend/src/tasks/permissions.ts`)

FamillAI's "child" rules become KMK's "user" rules:

| Action | User | Admin, super admin |
| --- | --- | --- |
| See every task and category | ✓ | ✓ |
| Create tasks (for anyone or the whole team) and categories | ✓ | ✓ |
| Edit or delete a task they created or are on | ✓ | ✓ |
| Edit or delete any task | | ✓ |
| Complete or reopen a task they created, are on, or that is for the whole team | ✓ | ✓ |
| Rename, change the icon of, or delete a category | | ✓ |

- "Clear completed" deletes only the completed tasks the caller may delete. The confirmation count shows that number.
- Audit rows, which never include title, description or category name text:
  - `task.create`, `task.update` (with the changed field names), `task.complete`, `task.reopen`, `task.delete`
    (each with the task id)
  - `task.clear_completed` (with the count)
  - `task_category.create`, `task_category.update`, `task_category.delete` (each with the category id)

### Frontend

- Route `/tasks` in `App.tsx`. Navigation item "Tasks" (a checklist icon) between Schedule and Users.
- `frontend/src/tasks/` holds:
  - `TasksPage`, `TaskRow`, `TaskDialog`, `TaskFields`, `CategorySelect`, `CategoryChips`, `CategoryManager`
  - `taskForm.ts` (pure form logic, with unit tests), `dueGroup` helpers
  - `api.ts`, `hooks.ts` (TanStack Query, with optimistic complete and reopen), `permissions.ts`, `tasks.css`
  - These are copied from FamillAI's `ui/src/features/tasks/` and its `components/Category*`, `SearchBox`, `FunEmpty`,
    and restyled on KMK's tokens. The reward, repeat, PIN, AI, offline and custom-icon code is removed.
- The people filter on Tasks is kept in the URL (`?people=1,4`), like FamillAI's `?view=`, so it survives a reload.
- Dashboard: `dashboard/TasksCard.tsx` sits in the existing `dash__grid`. There are three cards side by side on a wide
  screen, two from 768px and one on a phone (the exact breakpoints are the builder's call).
- Schedule: the "Show tasks" switch goes in `ScheduleToolbar`, and task chips go in `TimeGrid` (the all-day row),
  `MonthView` and `YearView` dots. Ticking a chip uses the same mutation as the Tasks page.
- Locale keys start with `task` (schedule keys start with `sch`). Every key is in all three files.

### Docs and operations

Update in the same change:

- `docs/README.md`: status row, data model, API and routes.
- `docs/security.md`: the visibility risk and the task rules.
- `docs/roadmap.md`: Tasks moves from "not built, by choice" to built.
- `docs/decisions.md`: the reversal, and that there are no repeating tasks.
- `CLAUDE.md`: the migrations list (now `0001` to `0007`) and the `tasks/` layout lines.

No new settings or compose changes are expected.

## Calls made after the builder check (mine, to be checked by the owner)

- **Edit rights in full.** Anyone who may edit a task may change everything on it, including its people. That means
  a person on a task can add or remove others, as with events. The audit log records who did it.
- **Categories.** Anyone may create one. Only admins rename, re-icon or delete one, even one the user created
  (FamillAI's adult rule).
- **A finished task on the Dashboard** stays struck through until the day ends in `America/Toronto`, using
  `completed_at`.
- **Reopening a task** clears `completed_at` and `completed_by`.

## Left to the builder

- Exact row counts in the Dashboard card.
- The task chip style on the Schedule.
- The checklist icon's drawing.
- Empty-state wording.
- How the category manager looks inside KMK's card style.
- Test file layout.
- Splitting the work into phases. The natural order is: backend and migration, then the Tasks page and categories,
  then the Dashboard card and the Schedule switch.

## Risks

- FamillAI's task components depend on helpers that KMK doesn't have yet (`matchesSearch`, `dueGroup`, `suggestIcon`,
  `CategoryChips` with scroll arrows). Each is copied with its tests rather than rewritten.
- Adding task chips to the time grid's all-day row can disturb the layout and drag logic. The existing schedule tests
  must stay green, and task chips are never draggable.
- If more than 1000 tasks pile up, the list endpoint truncates. "Clear completed" is the release valve. Paging is
  deferred.
