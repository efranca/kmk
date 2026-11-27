# Clients, role labels and quote-notification flag (design)

Status: draft for approval, 2026-11-27.

## Intent

The team handles quotes, then does the work for the people who accepted. Today nothing ties a job (Agenda item, task, document) to the customer it is for. Clients give every job a place to point to, and let the staff who work a job see where it is and how to reach the customer, without opening the quotes area.

## Goals

1. Display names: `superadmin` shows as "Administrator"; `user` shows as "Staff" (three languages). Role values, permissions and policy rules do not change.
2. A generic per-user JSON field `settings`, admin-edited, validated against a list of known keys. First key: `notify_quotes` (bool). A checkbox for it in the user modal.
3. When a quote is submitted, every active admin or super admin with `notify_quotes` on gets an email with a link to the quote.
4. A Clients section, same layout and design as Documents and Tasks: list with search, a client page, create and edit (admins), delete (admins).
5. Link a client from a task, an Agenda item, a document and a quote (one optional client each).
6. Create a client from a won quote (button, pre-filled, links the quote).

## Non-goals and anti-goals

- No change to what any role may do, apart from the Staff client visibility below.
- No many-clients-per-item links, no invoicing, no client portal or login.
- A Staff user never sees a client they are not scheduled for, and never sees admin notes.

## Constraints

- Follows CLAUDE.md: guard on every route, `policy.check` for authority, hand-written migration (0016), models in step, strings in all three locale files, docs updated, test first.
- Staff visibility is applied in SQL (as `documents/visibility.py` does), not filtered afterwards.

## Approaches

- **A. A nullable `client_id` on tasks, events, documents and quotes (chosen).** Simple queries; the client page lists its own items; deleting a client unlinks them (`ON DELETE SET NULL`). One client per item.
- B. A generic link table: many clients per item, but extra joins everywhere and no stated need.
- C. Text only: no listing or filtering, fails the goal.

## Design

**Data.** New table `clients`: id, name, kind (`airbnb`, `commercial`, `post_construction`, `other`), contact_name, email, phone, address, city, notes (admin only), created/updated by and at, `settings`-style room for growth not added (YAGNI). `client_id` added to `tasks`, `events`, `documents`, `quotes`. `users.settings jsonb not null default '{}'`.

**Who sees what.**
- Admin and super admin: all clients, all fields, full edit.
- Staff: only clients linked to at least one Agenda item the person is a participant of (past or future: my call, so the history stays readable). Fields: name, kind, contact, phone, email, address, city. Not notes. Read only. Staff see no documents of a client: the client page for Staff has Details and the Agenda items they are on, nothing else.
- Tasks and Agenda items already show to their participants; the linked client appears as a name chip, opening the client page only when the person may see it.
- Setting a client on a task or event: any user who may edit that item can pick from the clients they can see (Staff: those they are scheduled for; this means a staff-created event can only link a client they already see; admins link any).

**Settings field.** `PATCH` on the user (admin action through `policy.check`) accepts `settings` with known keys only; unknown keys are refused. The `actions`/user JSON carries it; audit row records the change (key names and values, nothing sensitive).

**Quote email.** In `quotes/arrival.py`, after submit, one email per opted-in admin (language of that admin), subject with the reference, body with type and city, and a button/link to `/quotes/{id}` (existing `new_quote_notice` template reused). The company `quote_notify_email` setting keeps working as an extra recipient (my call: no breaking change; can be retired later). Push and the shared task/Agenda item are unchanged.

**Frontend.** `clients/` folder: `ClientsPage` (list, search, kind filter, Add), `ClientPage` (tabs: Details, Documents, Tasks, Events, Quotes; Staff: Details and their Events only), `ClientDialog` (create/edit), `ClientPicker` (used in the task, event and document dialogs, and the quote page's "Create client"). Nav gets a Clients entry for everyone (Staff see it only if they have at least one client).

**Quote to client.** On a quote with status `won` and no client: "Create client" opens the dialog pre-filled (name, email, phone, address, city, kind from the quote). If a client with the same email exists, offer to link that one. Saving links `quotes.client_id`.

## Left to the builder (my calls, mark if you disagree)

- Pagination and search on the clients list follow the documents list.
- Exact label wording and the icon for the nav entry.
- Order of work: (1) labels, (2) settings field, checkbox and emails, (3) clients and links, as three plans/commits.
