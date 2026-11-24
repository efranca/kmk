# Tasks: board view, "in progress", more categories (round 2)

## Intent
The team wants to see work moving, not only done or not done. Tasks get a third status ("in progress") and a Kanban board where cards are dragged between columns, next to the existing list.

## Goals
- **Status:** `pending` (shown as "To do"), `in_progress` (new), `completed`. The "All" tab is dropped from the UI. Dashboard, Schedule chips and "Clear completed" treat anything not completed as open.
- **View menu:** the gear button next to "+" (today: categories toggle) opens a small menu, as FamillAI's `ViewMenuButton` does: **View: List / Board** and **Manage categories**. The view choice is remembered per device (`kmk.tasks.view`).
- **List view:** as today, with tabs To do / In progress / Done (no All), grouped by due date in To do.
- **Board view:** three columns To do / In progress / Done with a count each. Cards show icon, title, due date, category icon, people faces (same pieces as the row). Drag a card to another column to change its status; keyboard alternative: a "Move to" menu on each card (needed for phones and accessibility; on a phone the columns scroll sideways). Filters (people, categories, search) apply to the board. Order inside a column: by due date then newest (no manual ordering). Dragging needs the same permission as ticking a task (`canSetTaskStatus`); cards the person cannot move are not draggable.
- **Backend:** migration `0008` widens the status check to `('pending','in_progress','completed')`; `set_status` accepts `in_progress`; `completed_at`/`completed_by` still set only when completed; audit action `task_status_changed` for the in-progress moves (existing `task_completed`/`task_reopened` stay for those).
- **Categories:** a new category without an icon gets the default task icon (✅); the manager shows it that way too. More starter categories are seeded by the migration (only those missing, by name, case-insensitive): Cleaning 🧹, Supplies 🧴, Equipment 🔧, Clients 🏠, Vehicle 🚐, Maintenance 🛠️, Training 🎓, Safety 🦺, Admin 📄, Other 📌.

## Non-goals
Manual card ordering, swimlanes, more than three statuses, WIP limits, per-user views.

## Approaches
1. **Native HTML5 drag and drop** plus a "Move to" menu. Recommended: no new dependency (CLAUDE.md expects none), enough for three columns. Weak on touch, which the menu covers.
2. A drag library (dnd-kit). Better touch feel, but a new dependency to audit for a small win.

## Calls made by me
- "Task icon" = ✅ (emoji, because icons are emoji in this app). Easy to change.
- The seeded category list above; the owner can rename or delete them.
- Existing `status=all` API support stays (the Schedule uses it); only the tab goes away.
- The view menu replaces the gear's toggle behavior; opening the category manager still swaps the list for the manager, as today.

## Tests
Backend: status transitions incl. in_progress, permission, migration constraint. Frontend: view menu, view persisted, board columns by status, move via menu and via drop event, hidden "All" tab, default icon on new category.
