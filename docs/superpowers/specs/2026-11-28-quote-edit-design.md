# Edit a quote after saving (design, short)

Status: approved 2026-11-28 (in conversation).

## Intent

A quote often gets saved with data missing (a phone call without the address, a web request without a phone detail). Today the quote page only changes the status, the internal note and the linked client; everything else is frozen. Admins want to complete the missing data later.

## Goals

1. An **Edit** button on the quote page (admins and super admin) opens the same form as "manual quote", pre-filled.
2. Editable: name, phone, email, reply language, type, city, address, property type, frequency, bedrooms, bathrooms, area, listing link. For **manual** quotes also the description.
3. Works for both manual and web-form quotes.
4. Every edit writes an audit row (`quote_edited`) with the **names** of the changed fields only, never values.

## Non-goals and anti-goals

- Not editable: reference, dates, IP, approximate place, photos, status, internal note and client (those keep their own controls).
- The customer's description on a **web** quote stays as sent (it is the record of the request); the internal note is for the team's own words.
- No change to the task and Agenda item created when the quote arrived (their text carries reference, type and city at creation time).
- Anti-goal: an edit must never lose data the form does not show (unknown keys in `details` are kept) or leave an invalid combination (a type with a property or frequency that does not belong to it).

## Constraints

- CLAUDE.md conventions: guard on the route, `policy.check_quotes` first, errors `{"error": code}`, test first, strings in all locale files, docs kept accurate.
- The same validation as the manual form (`ManualQuoteIn`): phone format, per-type property and frequency, Airbnb-only fields.

## Approaches

1. **Whole-form `PUT /api/quotes/{id}/request`** reusing the manual form's model and dialog (chosen): one validation path, the dialog is shared between create and edit, the full set of fields is always consistent (the type changes together with its property and frequency).
2. Extend the existing partial `PATCH /api/quotes/{id}` with every field: more optional fields to validate against each other (type vs property/frequency) and a form that sends half-states.
3. Edit field by field in place: many small requests, no way to keep the type rules consistent.

## Design

- **Backend:** `QuoteEditIn` = the manual form without `client_id` (the linked client keeps its own control). `PUT /api/quotes/{id}/request` (`guard()`, `policy.check_quotes`): replaces name, phone, email, locale, kind and the known keys of `details` (other keys kept); `message` is changed only for `source = "manual"` quotes; for a web quote a `message` that differs from the stored one is `422 message_locked`. Takes the same row lock as the other quote changes. Audit `quote_edited` with the changed field names. Returns the quote detail like the other quote routes.
- **Frontend:** `ManualQuoteDialog` becomes create-or-edit (an optional `quote` prop pre-fills it; in edit mode there is no client picker and, for web quotes, the description is shown read-only). An **Edit** button on the quote detail's request card. Strings reuse the manual form's; new ones start with `quoteEdit`.
- **Tests:** backend (edit works for both sources, validation shared with the manual form, unknown `details` keys kept, `message_locked`, Staff 403, audit row without values) and frontend (dialog pre-filled, sends the whole form, read-only description on a web quote, hidden for Staff).
- **Docs:** `docs/README.md` API table, `docs/security.md` audit event list.

## Left to the builder

Where exactly the Edit button sits on the request card; the wording of the new strings in the four languages.
