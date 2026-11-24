# Documents: the company library

## Intent
A place to keep company documents (contracts, insurance, HR, finance, safety) where people find them again, with control over who may read each one. Modeled on FamillAI's Documents vault, simplified for a company with roles.

## Goals
- **Page** `/documents` in the nav (no Dashboard card): Tasks-style header with search (magnifier) and **+** (admins and super admin only), category chips with counts, a text list: file-type icon, title, category icon, visibility chip (Everyone / Admins / Super admin), size, who added it and when. No thumbnails. Tap opens a dialog: details, note, **Open** (new tab), **Download**, and for editors Edit, Replace file, Delete (confirmation).
- **Roles.** Admins and the super admin add, edit, replace and delete. Everyone signed in reads what their level allows.
- **Visibility per document:** `everyone`, `admins`, `superadmin`. A user sees `everyone`; an admin `everyone`+`admins`; the super admin all. A person can only set levels up to their own and can only edit or delete documents they can see. One function (`visible_levels(role)`) feeds the SQL `WHERE` of every read (list, get, file, counts, search), never a filter after loading. A document you may not see answers **404, the same as a missing one** (no leaking existence).
- **Fields:** title (<=200), category (optional), note (<=1000), visibility, one file. Search in the browser over title, category name, note and file name, ignoring case and accents (the list holds metadata only).
- **Categories** with icons (default icon for a new one), managed by admins in a manager like Tasks (shared look and `DEFAULT_CATEGORY_ICON` style). Seeded: Contracts, Insurance, HR, Finance, Safety, Clients, Other. Deleting a category leaves its documents uncategorized.
- **Files:** PDF, JPEG, PNG, WebP only, decided by magic bytes (`%PDF-` for PDF), never by the declared type or extension. **Limits (constants, no migration to change): 50 MB per file, 1 file per document, 500 documents, 2 GB for the library.** The first limit hit refuses the upload with `{"error": "file_too_large" | "library_full" | "too_many_documents" | "invalid_file"}` and the screen names it; nothing is truncated silently. Phone photos are scaled down in the browser (longest side about 2400 px) so they stay legible and small; PDFs go as they are.
- **Upload without leftovers.** Metadata first (`POST /api/documents`, JSON) creates a document with no file yet, visible only to its creator and ignored by lists; then the raw bytes go to `PUT /api/documents/{id}/file` (the same call also replaces a file). If the second step fails the screen deletes the pending document; stragglers older than one hour are purged on the next create. The visible result is all or nothing, with a progress bar and a clear error.
- **Endpoints** (every one `Depends(guard())`, writes CSRF-checked, `policy` helpers `can_view_document`, `can_manage_documents`): `GET /api/documents` (metadata + `categories`), `GET /api/documents/{id}`, `PATCH /api/documents/{id}`, `DELETE /api/documents/{id}`, `PUT /api/documents/{id}/file`, `GET /api/documents/{id}/file[?download=1]`, `POST/PATCH/DELETE /api/document-categories[/{id}]`. File serving sends the verified content type, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox`, `Cache-Control: private, no-store` and an escaped `Content-Disposition`. File names and contents never reach logs.
- **Audit** (no content, no file name): `document_added`, `document_updated`, `document_replaced`, `document_deleted`, `document_visibility_changed` (details: from/to), category actions. Downloads are not audited.
- **Migration `0011`:** `document_categories`, `documents` (metadata incl. `file_name`, `content_type`, `size_bytes`, nullable until the file arrives), `document_files(document_id pk -> documents on delete cascade, data bytea)` so list queries never touch bytes; CHECK on visibility and on `size_bytes`; `kmk_app` grants; models in step; seed categories.

## Operations and limits that make 50 MB safe
- **Caddy:** `/api/*` stays capped at 64 KB; a new matcher for `PUT /api/documents/*/file` allows `max_size 51MB`. A test or config check pins that only that route is wider. Cloudflare's 100 MB request cap on the free plan leaves room.
- **Memory:** the API container has 1 GB. Reading is streamed into one pre-sized buffer, capped while reading (declared length and running total), with **at most 2 uploads at once** (others get 503 `busy`, "try again in a moment"); `mem_limit` goes to 1.5 GB. Downloads stream from Postgres in one value (50 MB peak each).
- **Disk and backups:** files live in Postgres, so every encrypted daily and weekly backup contains them. The host disk is about 86% full, so the 2 GB cap is what bounds growth; About/operations docs note this and that moving backups off the disk is advisable before the library fills.

## Non-goals
Per-person private files, folders or tags, versions, full-text search inside files, thumbnails, offline copies, expiry reminders, multiple files per document, signed share links.

## Approaches
1. **Postgres `bytea` (chosen).** Already backed up and encrypted, no new volume or path safety, auth-guarded serving, bytes kept out of list queries by a separate table.
2. Files on a Docker volume. Small database, but a second backup path, path handling and drift between rows and files. Rejected.
3. Object storage. A new service and credentials for a small team. Rejected.

## Calls made by me
Default visibility **Admins** when adding (fail closed); one file per document; no `python-multipart` dependency (hence the two-step upload); `Feature` toggle not needed (no module switch exists in KMK); categories seeded as above.

## Tests
Backend: the visibility table for each role by list, by id and by file; uniform 404; magic-byte sniffing (fake PDF named `.pdf`, image with wrong declared type, empty body); each limit; concurrency cap; two-step upload and pending purge; replace; category CRUD and deletion keeps documents; audit rows without content; headers on file serving; guard coverage. Frontend: list/search/chips, add and replace flow with progress and failure cleanup, role-based buttons, visibility chips, dialog actions.
