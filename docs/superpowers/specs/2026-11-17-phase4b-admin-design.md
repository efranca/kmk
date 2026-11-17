# Phase 4b (Admin): user management page, user lifecycle, role rules

Builds on `scope.md` (§6 roles and admin rules), `docs/roadmap.md`, and the phase 2, 3 and 4a designs. Where this differs from `scope.md`, this document wins.

**Decision that overrides `scope.md` §6 (user, during design):** `scope.md` lets admins demote or delete other admins. Here, **only the super admin can create, demote, disable or delete admins**.
Admins manage regular users only. Reason: two-step verification is optional, so an admin account may be protected by a password alone; under the original rule one stolen admin password could remove every other admin.

## Intent
Give admins (and the super admin) a page to run the ~15 accounts without touching the database: see everyone, invite, correct, disable and re-enable, delete and restore,
reset passwords and two-step verification, and (super admin only) manage admins. Every action is audited and its effect on live sessions is immediate.

## Goals
- `GET /api/admin/users` and the lifecycle endpoints below, with one central, tested authority policy.
- An admin page at `/admin` in the KMK look, in EN / FR-CA / PT-BR, usable on a phone.
- The role rules: the super admin is protected from everyone; admins act only on `user`-role accounts; the last active admin-or-super-admin can never be removed or demoted; nobody acts destructively on themselves.
- Everything audited; every state-changing action that reduces access revokes the target's sessions.
- Documentation updated (`docs/README.md` API table, `docs/security.md` authority matrix, `docs/roadmap.md`, `docs/operations.md` if anything operational changes).

## Non-goals
Audit log viewer, bulk actions, pagination (the list is small), editing usernames, creating or transferring the super admin role (CLI only, as today), permanent (hard) deletion,
CSV export, a per-user session list, impersonation, forcing two-step verification (still the `MFA_REQUIRED_ROLES` switch).

## Anti-goals
A rule enforced only in the UI; two concurrent requests that together leave no admin; an action on the super admin by anyone other than the super admin (and then only the existing self reset);
an admin changing an admin; a disabled or deleted user keeping a working session; the page offering buttons the server would refuse.

## Constraints
- Phase 2-4a conventions: every route behind `guard`, Origin + CSRF on mutating requests, `kmk_app` cannot read `audit_log` (so "last sign-in" comes from `sessions`, not from the audit log), tests only on `kmk_test`, strings in three languages.
- Admin endpoints require a fully verified session (two-step state `ok`) and role `admin` or `superadmin`.
- The `kmk-public` site and other projects are not touched.

## Approaches considered (my calls unless noted)
- **Authority model:** as in `scope.md` (admins manage admins) vs only the super admin manages admins. **User: only the super admin.**
- **Where the rules live:** checks scattered in each endpoint vs one policy module with a table-driven test. **Pick: `app/auth/policy.py`**, called by every endpoint, tested as a full actor × target × action matrix.
- **Deleting:** soft delete that keeps username and email reserved, with a "restore" action, vs renaming a deleted account's identifiers to free them, vs hard delete. **Pick: soft delete + restore** (keeps history intact; a returning employee is restored, not re-created).
- **What buttons the page shows:** the client duplicates the rules vs the server returns the allowed actions per row. **Pick: the server computes `actions` per user** with the same policy that enforces them.
- **Confirming destructive actions:** browser `confirm()` dialogs vs inline two-step buttons. **Pick: inline** (accessible, testable, no blocking dialogs).
- **Last sign-in:** read the audit log (not permitted for the app role) vs the newest `sessions.created_at`. **Pick: sessions.**

## Decisions
**Authority (enforced server-side in `policy.py`):**
| Actor | May act on | Actions |
| --- | --- | --- |
| `superadmin` | `user` and `admin` accounts | everything below; never creates a second super admin; role changes only between `user` and `admin` |
| `admin` | `user` accounts only | view, invite (role `user`), edit, resend invite, reset password, reset two-step, disable, enable, delete, restore |
| anyone | the super admin account | nothing, except the existing rule that the super admin can trigger their own password reset |
| anyone | themselves | disable, delete, role change and two-step reset are refused (`403 cannot_target_self`); password reset allowed |
Refusals are `403 {"error": "forbidden"}` (authority) or `403 {"error": "cannot_target_self"}`. Unknown id `404 not_found`.
Inviting with `role: "admin"` and changing roles are super-admin-only.

**State machine (`users.status`):** `invited`/`active` → `disabled` (disable); `disabled` → `invited` if the user has no password yet, else `active` (enable); any non-deleted → `deleted` (delete, sets `deleted_at`, voids unused tokens);
`deleted` → `disabled` (restore, clears `deleted_at`; an admin then enables). Wrong source state: `409 {"error": "invalid_state"}`.
Disable, delete and role change revoke all of the target's sessions; two-step reset revokes them too.

**Last-admin invariant:** an admin demotion, disable or delete (only the super admin can do these) is refused with `409 {"error": "last_admin"}` if no other active admin or super admin would remain.
The check and the change run in one transaction that locks the privileged rows (`SELECT ... FOR UPDATE`), so two simultaneous requests cannot both pass.

**Endpoints** (`/api/admin/...`, all behind the verified-session guard and the admin role check; mutating ones need Origin and CSRF):
- `GET /users`: all accounts (including deleted), sorted by username: `id, username, email, role, locale, status, mfa_enabled, created_at, last_sign_in` (newest session start, or null) and `actions: [...]` (the actions the caller may take on that row).
- `POST /users`: existing, extended with optional `role` (`user` default, `admin` for the super admin only).
- `PATCH /users/{id}`: `{locale?, email?}`; email only while the target is `invited` (typo correction; the admin then re-sends the invite); duplicate `409 already_exists`.
- `POST /users/{id}/disable`, `/enable`, `/delete`, `/restore`; `POST /users/{id}/role` `{role: "user"|"admin"}`; `POST /users/{id}/reset-mfa` (`409 not_enabled` if none); existing `/invite` and `/reset`.

**Audit events (new):** `user_disabled`, `user_enabled`, `user_deleted`, `user_restored`, `user_role_changed` (details `from`, `to`), `user_updated` (details list the changed field names only, not values), `mfa_reset` (actor = the admin, details `via: admin`).
Existing `user_invited` gains `role` in its details.

**Frontend:** `/admin` (reached from a link on the signed-in page, shown only to admin and super admin; others see nothing). A searchable list: a table on wide screens, cards on phones; badges for role, status and two-step state; "show deleted" toggle;
per-row actions from the server's `actions` list; an "Invite" form (username, email, language, and role for the super admin); inline two-step confirmation for disable, delete, role change and two-step reset; plain feedback messages. The page never shows buttons the server did not list.
Admin accounts without two-step verification are flagged in the list as a nudge.

## Documentation deliverable
Update `docs/README.md` (endpoint table, status), `docs/security.md` (the authority matrix, state machine, session effects, new audit events), `docs/roadmap.md` (4b done; override of `scope.md` §6 recorded; next items), and `docs/operations.md` only if a command or setting changes. Check every statement against the running system before finishing.

## Verification the plan must cover
- A table-driven test of the whole policy: every actor role (`user` gets nothing, `admin`, `superadmin`) × target role × action × self/other, against the matrix above.
- The last-admin invariant, including a concurrency test where two requests race.
- State machine: every allowed transition, every refused one; sessions revoked on disable, delete, role change and two-step reset; a disabled or deleted user cannot sign in or use an old session; restore then enable works; a deleted account's username and email stay reserved.
- Edit rules (email only while invited; locale any time); duplicate email refused; `actions` in the list equals what the endpoints actually allow (tested by calling each listed action and each unlisted one).
- Audit rows written with the right actor and details, no email addresses in `user_updated`; the existing route-classification test passes with the new routes.
- Frontend: list rendering (table and card), search, deleted toggle, each action's request, inline confirmation, role-dependent Invite form, buttons shown only per `actions`, locale key parity.
- Live deploy checks through Caddy (anonymous and unverified sessions rejected on the new routes).

## Left to the builder
Module layout (the policy module's function shapes), query for `last_sign_in`, component structure and styling of the admin page, wording of messages, how the concurrency test coordinates two transactions.
