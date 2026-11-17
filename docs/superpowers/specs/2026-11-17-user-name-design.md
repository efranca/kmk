# A name for every person (user "Name")

Small change on top of the finished app (phases 1-6). Builds on `docs/README.md` (data model, API), the admin design (phase 4b) and the email layer (phase 3).

## Intent
Identify people by **name** wherever a person is shown, instead of only by their sign-in username: the greeting, the account page, the admin list, the emails, the server commands and the audit-log queries. `username` stays the sign-in handle.

## Goals
- One field, `name` ("Marie Tremblay", as typed). Shown everywhere a person is identified, with the username alongside where several people could share a name.
- Required when inviting someone; editable by an admin for plain users, and by the **super admin for everyone: plain users, admins and the super admin's own name** (owner's requirement); also settable with a server command.
- Emails greet by name ("Bonjour Marie Tremblay,"), falling back to the old wording when there is no name.
- The admin page lists and sorts by name and searches by name (accents and capitals ignored).

## Non-goals
Separate first and last names (the owner chose one field), people changing their own name, nicknames or profile pictures, using the name to sign in, a directory of people visible to regular users, uniqueness of names (two people can share one; the username tells them apart).

## Anti-goals
Names in audit details, logs or error messages (they are personal information, like email addresses); a name that can break an email or a page (newlines, markup, enormous length); the app breaking for accounts that have no name yet.

## Constraints
- The existing super admin has no name: the column must be nullable and every place that shows it falls back to the username.
- Today nobody can edit the super admin on the admin page, not even the super admin. The authority policy therefore gains **one exception: the super admin may edit their own account (name and language)**; admins still cannot edit admins or the super admin, and nobody else can touch the super admin account.
- Earlier conventions hold: strings in all three languages, tests first, every protected route behind the guard, the authority policy decides who may edit whom, the audit log never holds values such as email addresses.

## Approaches (my calls unless noted)
- **One field vs first + last name:** **owner chose one field.** Simpler, fits 15 people; the cost is the greeting uses the whole name.
- **How the super admin's own name gets fixed:** only a server command vs letting the super admin edit themselves on the admin page. **Owner: the super admin must be able to fix everyone's name, so the policy allows the super admin to edit their own account.** The server command `set-name` stays as well (useful before the first sign-in and as a fallback).
- **Required or optional:** required for new invitations (the API refuses a blank name); stored as optional in the database so existing rows stay valid. Not required for the super admin created by the command? **Pick: required there too** (`--name`).

## Decisions
- **Database (migration `0005`):** `users.name text` (nullable) with `CHECK (name IS NULL OR char_length(btrim(name)) BETWEEN 1 AND 100)`. No new grants needed.
- **Validation (one function used everywhere):** trim, collapse inner runs of spaces, 1 to 100 characters, no control characters or line breaks; letters (including accents and non-Latin), digits, spaces, apostrophes, hyphens and periods are fine. HTML is never trusted: the page escapes by construction, the email templates already escape.
- **Authority (the one policy change):** `edit` is allowed for the super admin on their own account; everything else in the matrix is unchanged (the self rules still forbid disabling, deleting, re-roling or resetting the two-step verification of oneself). The super admin may edit the name of anyone; an admin only of plain users.
- **API:** `name` (string or null) is added to the user payload (`/api/auth/login`, `/me`, the admin responses) and to each row of `GET /api/admin/users`; `POST /api/admin/users` requires `name`; `PATCH /api/admin/users/{id}` accepts `name` (same authority as editing the language: admins for plain users, the super admin for admins). The admin list is sorted by name (accents and capitals ignored), then username; accounts without a name sort by username.
- **Audit:** an edit of the name is recorded as `user_updated` with the field name `name` only, never the value (as with email); no audit event stores a name.
- **Emails:** `render(...)` takes the name; the greeting becomes "Bonjour {name}," / "Hello {name}," / "Olá {name}," when a name exists, otherwise the current wording. Subjects are unchanged (a name never goes into a header).
- **CLI:** `create-superadmin` gains `--name` (required); a new `set-name --username U --name "..."` sets or changes anyone's name (audited as `user_updated` with `via: cli`, no value), handy before the first sign-in; `docs/operations.md` documents both.
- **Frontend:** greeting and welcome page use `name` (fallback username); the account page shows "Name · username"; the admin list shows the name prominently with username and email beneath, searches name, username and email (accent-insensitive), the invite form gets a required "Name" field, and the inline edit form lets an admin (or the super admin, for everyone including their own row) change it. New strings `adminName` and the validation messages in all three languages.
- **Documentation:** `docs/README.md` (data model, API payloads), `docs/security.md` (the authority table gains the super admin's self-edit; names are personal information: visible only to admins and to the person, never in audit details or logs, included in the encrypted backups), `docs/golive.md` (invite instructions mention the name; the audit queries join `users` to show the name next to the username), `docs/operations.md` (the CLI), `docs/decisions.md` (a new entry), and the counts in `README.md`.
- **Deletion note:** deleting an account is soft (see decisions), so its name stays in the database and the encrypted backups; a true erasure feature is not built (recorded as a known limit for the privacy review).

## Verification the plan must cover
- The authority change: the super admin can edit their own name and language and everyone else's; an admin still cannot edit an admin or the super admin; a plain user can edit nobody; the policy matrix test and the "listed actions match what the endpoints allow" test are updated for the one exception.
- Migration and constraint (blank, too long, null allowed); the payload fields; invite requires a valid name (missing, blank, too long, control characters, extra spaces collapsed); edit rules for name follow the authority matrix (the existing "listed actions match what the endpoints allow" test keeps passing).
- The admin list sorts correctly with accents, capitals and missing names; the audit rows for a name edit contain the field name and no name; emails greet by name and fall back without one, in all three languages, and a name with markup or a line break cannot reach an email header or inject markup.
- The CLI commands (create with name, set-name, unknown user, invalid name); the existing super admin can be given a name.
- Frontend: greeting and account page with and without a name, list display, accent-insensitive search, required field in the invite form, inline edit, locale parity.
- Live: after deploy, the migration is applied, the super admin has a name set by the command, the greeting shows it.

## Left to the builder
The exact character rules within the limits above, how the accent-insensitive comparison is done, the layout of the name in the admin row, and the wording of the new strings.
