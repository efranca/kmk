# Invoices (design)

Status: approved 2026-11-27 (with the stored-PDF-linked-to-client addition).

## Intent

The company bills by hand today (a PDF built outside the app, the last one numbered 003; the app's first invoice is **007**). The Agenda already knows who was cleaned, where and when. Invoices turn finished Agenda work into a numbered PDF for the client, and track whether it was paid.

## Goals

1. An **Invoices** area for admins: list (search, filter by status), invoice page, create, cancel, mark paid.
2. **Invoice from the Agenda:** a "Bill" button on the client page lists that client's occurrences that are in the past, not cancelled and not yet billed. The admin ticks the ones to include, each line is priced automatically, and the invoice is created.
3. **Price per visit on the property** (`visit_price`). Every occurrence of an event for that property uses it. The price stays editable on the invoice before it is issued (discount or extra).
4. **Manual lines** (description + amount) for work with no Agenda event, e.g. a post-construction job nobody scheduled, or an extra.
5. A PDF that follows the existing model (`KMK Facture.pdf`): logo, "FACTURE N° 007", date, "Facturer à" (client name, address, city, phone), "Pour: KMK Entretien ménager", table Description / Montant, Sous-total, Taux de TVA, Coûts supplémentaires, COÛT TOTAL, footer with Lévis, phone, email, site, NEQ and the thank-you line.
6. **Status:** `unpaid` (A pagar) or `paid` (Paga, with the payment date), plus `cancelled`. The list shows it at a glance.
7. **Saved in the system, linked to the client.** Creating an invoice also stores its PDF in the Documents library as a document linked to the client (`client_id`), visibility `admins`, with title `Facture 007`. The client page shows an **Invoices** section listing that client's invoices (number, date, total, status) next to its documents. The stored PDF is the one sent and downloaded: it is generated once, when the invoice is created.
8. Send the PDF to the client by email from the invoice page (optional, one click; records when it was sent).

## Non-goals and anti-goals

- **No tax calculation.** The "Taux de TVA" line prints 0,00 $. The column exists (value 0) so tax can be switched on later without redoing invoices.
- No online payment, no Stripe/Interac, no overdue reminders, no partial payments.
- No automatic or recurring invoicing (a possible later phase on top of this).
- **Not covered for now:** the same property with two different prices (normal vs deep clean). Price is one number per property; a one-off change is made on the invoice.
- No client portal or login. Staff (role `user`) never see invoices or prices.
- An issued invoice is never edited (see below); anti-goal: billing the same cleaning twice.

## Constraints

- Follows CLAUDE.md: guard on every route, `policy.check` for authority, hand-written migration (0022), `models.py` in step, strings in every locale file (names start with `inv`), docs updated, test first, a visible-version minor bump.
- Admin and super admin only. Every create, send, mark paid, unmark and cancel writes an audit row (`audit.log`, no secrets).
- Numbering must be gap-free and safe under two admins issuing at once (serialize like `ratelimit.serialize`, advisory lock).

## Approaches (price location)

- Price on the event: simple, but repeated per event and wrong for one property with several events. Rejected.
- **Price on the property (chosen).** One number to change, derived from the place being cleaned; post-construction jobs are just a property of kind `post_construction` with the agreed amount.
- Property default plus per-event override: most flexible, two sources of truth. Deferred; it is the natural next step if the "two prices" case becomes common, and does not undo this design.

The price is agreed before the work, so storing it on the property fits how the company works.

## Design

**Data.**
- `properties.visit_price numeric(10,2) null` (admins only; Staff never receive it).
- `invoices`: id, `number` (integer, unique, shown as `007`), `client_id` (SET NULL on delete), snapshot of the billed-to data (name, address, city, phone, email: the invoice does not change if the client is edited later), `issued_on` (date, defaults to today, editable while drafting), `status` (`unpaid` | `paid` | `cancelled`), `paid_on`, `subtotal`, `tax` (0), `extra` (0, the "Coûts supplémentaires" line), `total`, `sent_at`, `cancelled_at`, `document_id` (the saved PDF, SET NULL), created/updated by and at.
- `invoice_lines`: id, `invoice_id`, position, `description`, `amount`, and for Agenda lines `event_id` + `occurrence_date` (the original date of the occurrence, the same key `event_exceptions` uses).
- **No double billing:** an occurrence (`event_id`, `occurrence_date`) can be on at most one non-cancelled invoice, enforced by the database (not only the screen). Cancelling an invoice frees its occurrences.
- Counter for the number, initialised so the first invoice is 007.

**Which occurrences are offered.** Expanded with the existing `schedule/occurrences.py` (so one-off changes and cancellations are respected) for the chosen client, date in the past, not cancelled, not already on a live invoice. No "completed" status is introduced: the admin unticks what should not be billed. Each line's default description: `Entretien ménager - <property name> - <date>`, editable. Occurrences whose event has no property or no price show an empty amount to fill in.

**Life of an invoice.**
- Created and issued in one step (number assigned then). Lines and amounts can be adjusted on the screen before pressing Create; after that the invoice is read-only.
- `unpaid` → `paid` (enter the payment date; can be undone by an admin, audited) .
- `unpaid` or `paid` → `cancelled` with a confirmation; the number is kept (never reused) and the occurrences are released. A correction is a cancel plus a new invoice.

**Screens (admins).**
- Sidebar entry **Invoices**: list with number, client, date, total, status chip; search; filter unpaid/paid/cancelled. A total of what is still unpaid on top.
- Client page: an Invoices section and a "Bill" button → checklist of occurrences with editable amounts and "add a line", total at the bottom, Create.
- Invoice page: details, lines, status actions (mark paid, send, download PDF, cancel).
- Property form (client page): new "Price per visit" field.

**PDF.** Generated on the server from the invoice snapshot, always French (as the model), downloaded from the invoice page and attached to the email. The company block (Lévis, phone, email, site, NEQ) lives in one place in code, with the logo as a static asset: a copy of `frontend/public/logo-horizontal.png` (600×200 RGBA, the same image the existing PDF embeds) placed in the backend package, since the API image does not contain the frontend. The PDF is generated once at creation and saved as a Document (see Goal 7): `invoices.document_id` points to it, visibility `admins` (Staff can never see it, even though Staff may see other documents of a client they are scheduled for), file name `Facture-007.pdf`, category "Factures" (created if missing). Cancelling an invoice keeps its document, and the title is changed to `Facture 007 (annulée)`; the PDF itself is not altered. Deleting that document by hand from the library is refused while the invoice exists (or the invoice keeps working without it: builder's call, but the invoice must stay downloadable, so regenerating from the snapshot is the fallback).

**Email.** Through the existing `emails/` layer to the client's email (editable on the send dialog), PDF attached, French text. Failure leaves the invoice unchanged and shows an error; success sets `sent_at`.

**Backend layout.** New `backend/app/invoices/` (`schemas.py`, `service.py`, `routes.py`, `pdf.py`), following `clients/` and `tasks/`. Tests: numbering (start at 007, no gaps, concurrent issue), no double billing, cancel frees occurrences, Staff gets 403/404 everywhere and never sees `visit_price` or the invoice document (including through the client page and Documents), guard test for the new routes, totals, PDF is produced (starts with `%PDF`, contains the number and total), email sent with attachment.

## What is left to the builder

- The PDF library (the API image has none today; prefer something that needs no extra system packages unless the layout requires it; update the Dockerfile if it does).
- Exact table/index shapes for the no-double-billing rule and the number counter.
- Layout details of the checklist and list, matching Clients and Tasks.

## Calls I made (change any of them)

- First number 007, then +1; the number is never reused after a cancel.
- Invoice date defaults to today and is editable before creating.
- Past, non-cancelled occurrences count as "done" (the Agenda has no completed state).
- Cancelled is a third status next to unpaid/paid; no "overdue" status.
- Billed-to data is copied onto the invoice (a snapshot).
- The PDF is stored as an admins-only Document linked to the client, with the same visibility rule enforced in SQL; PDF in French only; company data in code, not in Settings.
