# Documents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A company document library: admins add PDFs/images (50 MB max) with per-document visibility; everyone reads what their level allows.

**Architecture:** Postgres tables `document_categories`, `documents` (metadata) and `document_files` (bytes, separate so lists never load them). One visibility function feeds every SQL read. Two-step upload (metadata, then raw bytes). Caddy widens only the file-upload route; at most 2 concurrent uploads.

**Tech Stack:** FastAPI (no new dependency), SQLAlchemy, Alembic, Caddy, React, vitest, pytest.

**Spec:** `docs/superpowers/specs/2026-11-24-documents-design.md`

## Global Constraints
- Limits as constants in `app/documents/limits.py`: `MAX_FILE_BYTES = 50*1024*1024`, `MAX_DOCUMENTS = 500`, `MAX_LIBRARY_BYTES = 2*1024**3`, one file per document, `PENDING_TTL = 1 hour`, `MAX_CONCURRENT_UPLOADS = 2`.
- Types by magic bytes only: PDF `%PDF-`, JPEG, PNG, WebP (reuse the avatar `sniff` for images; add PDF).
- Visibility `everyone|admins|superadmin`; `visible_levels(role)`: user {everyone}, admin {everyone, admins}, superadmin all. Used in the SQL `WHERE` of list, get, file, counts; invisible documents answer 404 exactly like missing ones. A person can set/edit only levels they can see.
- Writes: admin and super admin only (`policy.can_manage_documents`). Every route guarded (`guard()` for writes, `guard(csrf=False)` for reads). Errors `{"error": code}`: `invalid_file`, `file_too_large`, `library_full`, `too_many_documents`, `busy`, `not_found`.
- Serving: verified content type, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox`, `Cache-Control: private, no-store`, escaped `Content-Disposition` (`inline` or `attachment` with `?download=1`). File names and bytes never logged or audited.
- Audit (plain INSERT, no content or file name): `document_added/updated/replaced/deleted/visibility_changed`, category actions.
- Default visibility when adding: `admins`. Deleting a category sets `category_id` NULL.
- Compose: api `mem_limit: 1536m`. Caddy: `/api/*` stays `max_size 64KB`; only `PUT /api/documents/*/file` allows `51MB`.
- Migration `0012` hand-written, models in step, `kmk_app` grants, seed categories (Contracts, Insurance, HR, Finance, Safety, Clients, Other, with icons). Three locales (keys `doc*`), identical sets. Commit trailer as usual.

## Review Focus
- A user must not see admin-only documents by list, by id, by file URL, by search or in category counts; admin must not touch superadmin-only ones; all answer 404.
- A `.pdf` named file that is not a PDF, an image declared with the wrong type, an empty body and a 50 MB + 1 byte body are all refused with nothing stored.
- A failed or abandoned upload leaves no visible document; pending rows older than an hour are purged.
- Third concurrent upload is refused with 503 `busy` and does not wedge the others.
- Replace keeps the document's id/metadata and swaps bytes atomically; delete cascades the bytes.

---

### Task 1: Migration, models, limits, visibility

**Files:** Create `backend/alembic/versions/0012_documents.py`, `backend/app/documents/{__init__,limits,visibility,files}.py`, `backend/tests/test_schema_documents.py`, `backend/tests/test_documents_visibility.py`; modify `backend/app/models.py`.
**Interfaces:** Produces models `DocumentCategory(id, name, icon, created_by, created_at)`, `Document(id, title, note, category_id, visibility, created_by, updated_by, created_at, updated_at, file_name, content_type, size_bytes)`, `DocumentFile(document_id, data)`; `visible_levels(role: str) -> frozenset[str]`; `can_view(role, visibility) -> bool`; `files.sniff_document(data: bytes) -> str | None` (returns content type).

- [ ] **Step 1: Failing tests:** schema (tables, CHECK on visibility, cascade from `documents` to `document_files`, grants for `kmk_app`, seeded categories); `visible_levels` for the three roles; `sniff_document`: real PDF/JPEG/PNG/WebP bytes accepted, text with `%PDF` missing rejected, empty rejected, a PDF header inside an image body rejected.
- [ ] **Step 2:** run; Expected FAIL. **Step 3:** write the migration as explicit SQL and the modules. **Step 4:** run `tests/test_schema_documents.py tests/test_documents_visibility.py tests/test_schema_permissions.py`; re-migrate the test DB first. Expected PASS. **Step 5: Commit** `feat(documents): schema and visibility rules`.

### Task 2: Metadata API and categories

**Files:** Create `backend/app/documents/{schemas,service,routes}.py`, `backend/tests/test_documents_api.py`, `backend/tests/test_document_categories_api.py`; modify `backend/app/auth/policy.py`, `backend/app/main.py`.
**Interfaces:** `GET /api/documents` -> `{documents: [...metadata, has_file only true], categories: [...]}`; `POST /api/documents` (JSON `{title, note?, category_id?, visibility}`) -> 201 with the pending document (creator-only until a file arrives); `GET/PATCH/DELETE /api/documents/{id}`; `GET/POST/PATCH/DELETE /api/document-categories`.

- [ ] **Step 1: Failing tests:** the full visibility table by role for list/get/patch/delete (uniform 404, never 403); a user cannot POST (403), admin can; admin cannot set `superadmin`; pending documents absent from lists and from other people's gets, purged when older than `PENDING_TTL` on the next POST; PATCH visibility writes `document_visibility_changed`; category CRUD (admin), default icon, delete leaves documents uncategorized; title/note length limits 422; audit rows without content; `MAX_DOCUMENTS` and `too_many_documents` (patch the constant low in the test).
- [ ] **Step 2:** run; FAIL. **Step 3:** implement; every SELECT applies `Document.visibility.in_(visible_levels(role))`. **Step 4:** run these tests plus `tests/test_mfa_guard.py tests/test_policy.py`. Expected PASS. **Step 5: Commit** `feat(documents): metadata and category API`.

### Task 3: File upload, replace and serving

**Files:** Create `backend/app/documents/uploads.py`, `backend/tests/test_documents_files.py`; modify `backend/app/documents/routes.py`, `deploy/caddy/Caddyfile`, `deploy/docker-compose.yml`.
**Interfaces:** `PUT /api/documents/{id}/file` (raw body) -> 204; `GET /api/documents/{id}/file[?download=1]`; `async read_capped(request, limit) -> bytes` reading into one buffer; module-level `asyncio.Semaphore`-style counter `MAX_CONCURRENT_UPLOADS` raising `ApiError(503, "busy")`.

- [ ] **Step 1: Failing tests:** accept a small real PDF and PNG, set `file_name` from the `X-File-Name` header (percent-decoded, path separators stripped, <=200), `content_type`, `size_bytes`, document becomes visible; refuse wrong magic bytes, empty, declared `Content-Length` over the limit before reading, running total over the limit while streaming (patch `MAX_FILE_BYTES` to a few KB in tests); `library_full` when the sum of sizes plus the new file exceeds `MAX_LIBRARY_BYTES` (patched low); replace swaps bytes and size; a user cannot upload (403), an admin cannot upload to a superadmin-only document (404); download headers exactly as in Global Constraints, `Content-Disposition` escaping with quotes/newlines/non-ASCII in the name; invisible document file -> 404; third concurrent upload -> 503 (simulate by holding two slots); delete removes the bytes (no `document_files` row).
- [ ] **Step 2:** run; FAIL. **Step 3:** implement; read the bytes once, validate, then single INSERT/UPDATE of `document_files` and the document's metadata in one transaction. Caddyfile: add a `@docfile path_regexp` matcher placed before the generic `/api/*` handler, with `request_body { max_size 51MB }`; compose: `mem_limit: 1536m` with an updated comment. Add a test in `test_deploy_config.py` (or a Caddyfile text test) asserting the 64KB cap is still on the generic handler and 51MB appears only for the file route.
- [ ] **Step 4:** run `tests/test_documents_files.py tests/test_deploy_config.py tests/test_mfa_guard.py`. Expected PASS. **Step 5: Commit** `feat(documents): upload, replace and download`.

### Task 4: Documents page

**Files:** Create `frontend/src/documents/{DocumentsPage,DocumentRow,DocumentDialog,DocumentForm,CategoryManager,hooks,api,documentSearch,prepareDocument}.ts(x)`, tests beside them, `documents.css`; modify `App.tsx` (route), `app/Nav.tsx` (entry for everyone), locales.
**Interfaces:** `searchDocuments(docs, categories, query): Document[]` (case/accents-insensitive over title, category name, note, file name); `prepareDocument(file: File): Promise<File>` (images scaled so the longest side <= 2400 px as JPEG; PDFs unchanged; over 50 MB or unsupported type rejected with a code); `uploadDocument(meta, file, csrf, onProgress)` does POST then PUT and deletes the pending document if the PUT fails.

- [ ] **Step 1: Failing tests:** search ignores case/accents and matches each field; list shows chips with counts, visibility chips, size; "+" and Edit/Replace/Delete only for admin/super admin; add flow shows progress and, on a failed PUT, deletes the pending document and shows the limit-specific message (`file_too_large`, `library_full`, `invalid_file`, `busy`); default visibility Admins; a user sees no visibility choices above their level; category manager with default icon; Open/Download links point to the file URL.
- [ ] **Step 2:** run; FAIL. **Step 3:** implement in the Tasks style (reuse `PageHeader`, `Dialog`, chips, `ViewMenuButton` pattern for the gear/category manager). Use `XMLHttpRequest` for the upload to get progress. **Step 4:** `npx vitest run && npx tsc --noEmit && npm run build`. Expected PASS. **Step 5: Commit** `feat(documents): Documents page`.

### Task 5: Docs and full verification

- [ ] **Step 1:** update `docs/README.md`, `docs/security.md` (visibility model, serving headers, limits, audit actions, backup-size note), `docs/operations.md` (Caddy restart, memory limit, disk/backup warning), `CLAUDE.md` layout line. **Step 2:** run the full frontend suite and, alone and in the background, the full backend suite. Expected all pass. **Step 3: Commit** `docs: documents`.
