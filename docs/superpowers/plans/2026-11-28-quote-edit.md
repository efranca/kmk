# Edit a Quote After Saving Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admins complete the missing data of a saved quote (manual or from the web form) with an Edit button that reuses the manual-quote form.

**Architecture:** `ManualQuoteIn` is split into a shared base (`QuoteFieldsIn`) so the manual form and the new `QuoteEditIn` share one validation path. A whole-form `PUT /api/quotes/{id}/request` replaces the editable fields; the frontend's `ManualQuoteDialog` becomes create-or-edit.

**Tech Stack:** FastAPI, SQLAlchemy 2, pydantic, React + TanStack Query + react-i18next, pytest, vitest.

**Spec:** `docs/superpowers/specs/2026-11-28-quote-edit-design.md`

## Global Constraints

- Follow `CLAUDE.md`: guard on the route (`guard()`), `policy.check_quotes` first, error bodies `{"error": "<code>"}`, test first and watch it fail, `audit.log(...)` only, strings in all four locale files (`fr-CA`, `en`, `pt-BR`, `es`) and a test checks the key sets match.
- Admins and super admin only. Staff get `403 {"error":"forbidden"}`.
- Editable: name, phone, email, reply language, type, city, address, property, frequency, bedrooms, bathrooms, area, listing link; the description only for `source == "manual"` quotes. Not editable: reference, dates, IP, place, photos, status, internal note, client.
- A web quote's description stays as sent: a `message` that differs from the stored one is `422 {"error":"message_locked"}`.
- `quote.details` keys the form does not know are kept.
- Audit row `quote_edited` with `{"quote_id", "fields": [names]}`: names only, never values.
- Work on `main` in `/home/evandro/projects/kmk`; run backend tests with `cd backend && .venv/bin/pytest -q <files>`; never run two pytest processes at once (shared `kmk_test` database).
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Type change with leftovers:** changing Airbnb to Commercial while the quote has bedrooms or a listing link must be refused (`422`), not saved half-valid. Test in Task 1.
2. **Web quote with unknown `details` keys** (anything the form does not show) survive an edit. Test in Task 1.
3. **Clearing the email** (empty) stores `""` like a manual quote, and replies are then logged instead of emailed. Test in Task 1.
4. **Editing nothing** writes no audit row. Test in Task 1.
5. **Staff** cannot edit (`403`). Test in Task 1.

---

### Task 1: Backend: shared model, service and route

**Files:**
- Modify: `backend/app/quotes/schemas.py` (split `ManualQuoteIn`), `backend/app/quotes/service.py`, `backend/app/quotes/routes.py`
- Test: `backend/tests/test_quotes_edit.py`

**Interfaces:**
- Produces: `class QuoteFieldsIn(BaseModel)` (all current `ManualQuoteIn` fields except `client_id`, with its validators, `_per_kind` and `details()`); `class ManualQuoteIn(QuoteFieldsIn)` adding only `client_id`; `class QuoteEditIn(QuoteFieldsIn)` (nothing added; `message` omitted vs sent is told apart with `model_fields_set`).
- Produces: `service.edit_quote(db: Session, actor: User, quote_id: int, data: QuoteEditIn, ip: str) -> Quote`; route `PUT /api/quotes/{quote_id}/request` → `{"quote": <quote_payload>}`.

- [ ] **Step 1: Write the failing tests** in `test_quotes_edit.py` (helpers: `session` and `new_quote` from `test_quotes_api.py`, `body` from `test_quotes_manual.py`; a web quote is made with `new_quote(client)` using the plain `client` fixture, then edited by an admin session; a manual one with `POST /api/quotes`):
  - `test_edit_a_manual_quote`: create manual with only name+phone+kind; `PUT .../request` with `body(name="Chantal R.", email="Chantal@Example.com", address="12 rue X", message="New text")` → 200, the payload has the new name, `email == "chantal@example.com"`, `details["address"] == "12 rue X"`, `message == "New text"`, same `id`, `status` and `reference` unchanged.
  - `test_edit_a_web_quote_keeps_its_description_and_unknown_details`: `sql(owner_engine, "UPDATE quotes SET details = details || '{\"extra_key\": \"kept\"}'::jsonb WHERE id = :i")`; edit with the stored message omitted → 200, `message` unchanged, `details["extra_key"] == "kept"`, new fields applied; sending a different `message` → `422 {"error":"message_locked"}`; sending the same `message` as stored → 200.
  - `test_edit_refuses_what_the_manual_form_refuses`: parametrized bad bodies `{"phone":"abc"}`, `{"email":"nope"}`, `{"property":"castle"}`, `{"kind":"commercial","bedrooms":2}`, `{"colour":"red"}`, `{"client_id": 1}` → all 422 (client_id is an unknown field here).
  - `test_clearing_the_email_stores_an_empty_one`: edit with `email=None` → `email == ""`.
  - `test_audit_names_only_the_changed_fields`: change `city` and `phone` → one `quote_edited` row whose `details["fields"]` sorted equals `["city","phone"]` and whose text contains neither new value; an edit that changes nothing writes no row.
  - `test_only_admins_edit`: anonymous 401, Staff 403, unknown id 404.
- [ ] **Step 2: Run** `.venv/bin/pytest -q tests/test_quotes_edit.py` — expected FAIL (404/405: no route).
- [ ] **Step 3: Split the model** in `schemas.py` (`QuoteFieldsIn` base, `ManualQuoteIn(QuoteFieldsIn)` with `client_id`, `QuoteEditIn(QuoteFieldsIn)`; the `_per_kind` validator's return annotation becomes the base) and run `tests/test_quotes_manual.py` — expected still PASS.
- [ ] **Step 4: Implement `edit_quote`** in `service.py`: `get_quote(db, quote_id, lock=True)`; for `source == "web"` a sent `message` (`"message" in data.model_fields_set`) different from `quote.message` raises `ApiError(422, "message_locked")`; for `source == "manual"` a sent message replaces it. Replace `name`, `phone`, `email` (`data.email or ""`), `locale`, `kind`; build `details` as the stored dict minus the form's keys (`city, address, property, frequency, bedrooms, bathrooms, area_sqft, listing_url`) plus `data.details()` (reassign a new dict so JSONB is saved). Collect the names of fields whose value changed (top-level names, detail keys under their own names, `message`); if any, `audit.log(db, "quote_edited", actor_user_id=actor.id, ip=ip, details={"quote_id": quote.id, "fields": sorted(changed)})`; always set `updated_at`. Add the route in `routes.py` next to `change_quote` (`Depends(guard())`, `policy.check_quotes` first, commit after building the payload).
- [ ] **Step 5: Run** `.venv/bin/pytest -q tests/test_quotes_edit.py tests/test_quotes_manual.py tests/test_quotes_api.py tests/test_mfa_guard.py` — expected PASS.
- [ ] **Step 6: Commit** `feat(quotes): edit a saved quote's request data (backend)`.

---

### Task 2: Frontend: Edit button and edit mode of the dialog

**Files:**
- Modify: `frontend/src/quotes/api.ts` (`editQuote`), `frontend/src/quotes/hooks.ts` (`useEditQuote`), `frontend/src/quotes/ManualQuoteDialog.tsx`, `frontend/src/quotes/QuoteDetailPage.tsx`, the four locale files
- Test: `frontend/src/quotes/QuoteEdit.test.tsx`

**Interfaces:**
- Produces: `editQuote(id: number, input: Omit<ManualQuoteInput, "client_id">, csrf: string): Promise<QuoteDetail>` (`PUT /api/quotes/${id}/request`); `useEditQuote(id: number)` (same shape as `useUpdateQuote`, so the open quote and the lists refresh).
- Produces: `ManualQuoteDialog({ onClose, onCreated, quote? })`: with `quote` (a `QuoteDetail`) the form starts pre-filled from it, the title is `quoteEditTitle`, there is no client picker, the save calls `useEditQuote` and then `onClose`; for a quote with `source === "web"` the description is shown as read-only text and not sent. Without `quote` it behaves as today.
- Produces strings (all four locales): `quoteEdit` ("Edit"), `quoteEditTitle` ("Edit the quote"), `quoteEditDone` ("Quote updated"), `err_message_locked` ("The customer's description cannot be changed.").

- [ ] **Step 1: Write the failing tests** in `QuoteEdit.test.tsx` (patterns of `QuoteDetail.test.tsx`, `detail()` from `fixtures.ts`, admin session):
  - `pre-fills the form from the quote`: opening Edit on `detail({ source: "manual", message: "Called Tuesday" })` shows the name, phone, city, address, the description textarea with "Called Tuesday", and no client picker.
  - `sends the whole form to PUT /api/quotes/5/request`: change the address and clear the email, save → one `PUT` with `address` changed, `email: null`, `message` present (manual), no `client_id`; the toast `Quote updated` shows.
  - `a web quote's description is read-only and not sent`: `detail({ source: "web" })` → the description is plain text (no textarea), the `PUT` body has no `message` key.
  - `shows a server refusal`: `PUT` answering `422 {"error":"message_locked"}` shows that message and keeps the dialog open.
  - `the Edit button is on the quote page for an admin`: `QuoteDetailPage` for a `role: "admin"` session shows an **Edit** button. (Staff never reach quotes: the app routes them to the Dashboard and the API answers 403, both already tested; Review Focus 5 is covered by Task 1's `test_only_admins_edit`.)
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/quotes/QuoteEdit.test.tsx` — expected FAIL.
- [ ] **Step 3: Implement** the API function, the hook, the dialog's edit mode and the button (in the request card's header of `QuoteDetailPage`, next to the "Request" heading; a pencil `Button` with `t("quoteEdit")`, opening the dialog with `quote`), and the four locale entries.
- [ ] **Step 4: Run** `npx vitest run && npx tsc --noEmit -p . && npm run build` — expected all PASS.
- [ ] **Step 5: Commit** `feat(quotes): edit a saved quote from its page`.

---

### Task 3: Docs and final check

**Files:**
- Modify: `docs/README.md` (API table: `PUT /api/quotes/{id}/request`), `docs/security.md` (audit event list: `quote_edited`, field names only)

- [ ] **Step 1: Update** the two files.
- [ ] **Step 2: Run** the whole backend suite once (`cd backend && .venv/bin/pytest -q`, about 14 minutes, alone) and `cd frontend && npx vitest run` — expected all PASS.
- [ ] **Step 3: Commit** `docs(quotes): editing a saved quote`.
