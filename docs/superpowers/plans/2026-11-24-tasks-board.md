# Tasks Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Add the "in progress" status, a Kanban board with drag and drop, a List/Board view menu on the gear button, a default icon for new categories, and seeded starter categories.

**Architecture:** Backend gains one status value, one route (`POST /api/tasks/{id}/start`) and migration `0008`. Frontend adds a `setStatus` mutation, a `ViewMenuButton`, a `TaskBoard` (HTML5 drag and drop plus a "Move to" menu) and a remembered view.

**Tech Stack:** FastAPI, SQLAlchemy, Alembic (hand-written SQL), React, TanStack Query, vitest, pytest.

**Spec:** `docs/superpowers/specs/2026-11-24-tasks-board-design.md`

## Global Constraints

- Statuses: `pending` (shown "To do"), `in_progress`, `completed`. `completed_at`/`completed_by` set only when completed (DB constraint `tasks_completed_consistent` stays).
- Default category icon: `✅`. Seeded categories: Cleaning 🧹, Supplies 🧴, Equipment 🔧, Clients 🏠, Vehicle 🚐, Maintenance 🛠️, Training 🎓, Safety 🦺, Admin 📄, Other 📌 (skip any whose name exists, case-insensitive).
- localStorage key `kmk.tasks.view` ("list" | "board").
- Guard on the new route; audit via `audit.log`; new strings in all three locale files; CLAUDE.md rules apply. Backend tests: `cd backend && .venv/bin/pytest -q`; frontend: `cd frontend && npx vitest run`.

## Review Focus

- A person who may not set the status cannot drag a card (and the server refuses).
- Dropping a card on its own column does nothing (no request).
- A failed move snaps the card back.
- Every place that treated `pending` as "open" now also counts `in_progress` (Dashboard, Schedule chips, summary counts).
- Seeding twice does not duplicate categories.

### Task 1: Backend (migration 0008, status, route)
**Files:** Create `backend/alembic/versions/0008_task_in_progress.py`; modify `backend/app/tasks/service.py`, `routes.py`, `backend/app/models.py` (if the check is mirrored), tests `backend/tests/test_tasks_api.py`, `test_schema_tasks.py`, `test_mfa_guard.py` public list only if needed.
- [ ] Failing tests: `POST /api/tasks/{id}/start` sets `in_progress` with `completed_at` null; completing then starting clears completed fields; reopen returns `pending`; `GET /api/tasks?status=in_progress` lists only those; a person not on the task gets 403 on start; the DB refuses `status='bogus'`; categories seeded after migration (query by name) and the migration SQL is idempotent.
- [ ] Implement migration: drop `tasks_status`, add check with three values; `INSERT ... SELECT` seeds with `WHERE NOT EXISTS (lower(name)=lower(...))`; downgrade maps `in_progress` to `pending` and restores the check (seeds are left).
- [ ] `set_status` audit action by status: `task_completed` / `task_reopened` (pending) / `task_started` (in_progress). `list` route accepts `in_progress`. Add `_status_route("/{task_id}/start", "in_progress")`.
- [ ] Run backend suite (PASS). Commit `feat(tasks): in progress status`.

### Task 2: Frontend data layer and "open" semantics
**Files:** `frontend/src/tasks/types.ts`, `api.ts`, `hooks.ts`, `hooks.test.tsx`, `dashboard/myTasks.ts`, `schedule/TaskChip.tsx` and any other `=== "pending"` use (`grep -rn '"pending"' frontend/src`).
- **Produces:** `TaskStatus = "pending" | "in_progress" | "completed"`; `StatusFilter = TaskStatus | "all"`; `startTask(id, csrf)`; `useSetTaskStatus()` mutation taking `{ task: Task; status: TaskStatus }` with the same optimistic update and rollback as `useToggleTask` (calls complete / start / reopen).
- [ ] Failing tests: `useSetTaskStatus` moves a cached task to in_progress and posts `/start`; rolls back on 403; `myTasks` keeps in-progress tasks in the open groups.
- [ ] Implement; change open checks to `status !== "completed"`. Run suite. Commit `feat(tasks): in progress in the data layer`.

### Task 3: View menu, tabs, default icon
**Files:** create `tasks/ViewMenuButton.tsx` (+test), `tasks/useTasksView.ts` (+test); modify `TasksPage.tsx`, `CategoryManager.tsx`, `CategoryChips.tsx`, locales.
- **Produces:** `useTasksView(): ["list" | "board", (v) => void]`; `ViewMenuButton({ view, onView, onManage, managing })`: a gear `IconButton` opening a menu with radio items List / Board and an item "Manage categories"; while managing the gear just closes the manager.
- [ ] Failing tests: menu lists the three items; choosing Board calls `onView("board")` and stores `kmk.tasks.view`; garbage storage falls back to list; List tabs are To do / In progress / Done and there is no All tab; a new category added with no icon is posted with icon `✅`.
- [ ] Implement; `FALLBACK_CATEGORY_ICON` becomes `✅`; the manager posts `icon: icon || "✅"`. Keys: `taskStatusInProgress`, `taskView`, `taskViewList`, `taskViewBoard`, `taskEmptyInProgress`, `taskStartedToast` (not needed) in en/fr-CA/pt-BR.
- [ ] Suite PASS. Commit `feat(tasks): view menu and status tabs`.

### Task 4: Board
**Files:** create `tasks/TaskBoard.tsx`, `TaskBoard.test.tsx`; modify `TasksPage.tsx`, `tasks.css`, locales.
- **Produces:** `TaskBoard({ tasks, people, categoryById, today, canMove(task): boolean, onMove(task, status), onOpen(task) })`. Columns To do / In progress / Done with counts; cards `draggable` only when `canMove`; `onDrop` on a column calls `onMove` unless the status is unchanged; each card has a "Move to" `<select>` or menu (accessible name `taskMoveTo`) with the other two columns; column order by due date then newest.
- [ ] Failing tests: tasks land in the right columns with counts; `dragStart` on a card then `drop` on another column calls `onMove(task, status)`; dropping on the same column does nothing; a card with `canMove` false has no `draggable` and no move control; the Move-to control calls `onMove`.
- [ ] Implement; wire in `TasksPage` (board view uses `all` tasks, people/category/search filters, `useSetTaskStatus`, `canSetTaskStatus`); hide status tabs and "Clear completed" grouping in board view (keep Clear completed under the Done column header action). CSS: three columns on desktop, horizontal scroll on phones, drop-target highlight.
- [ ] Suite + `npm run build` PASS. Commit `feat(tasks): board view with drag and drop`.

### Task 5: Docs
- [ ] Update `docs/README.md` (tasks row, statuses, view menu, seeded categories) and `docs/roadmap.md` if it lists tasks. Commit `docs: tasks board`.
