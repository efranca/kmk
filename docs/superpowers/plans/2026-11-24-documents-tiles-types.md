# Documents: file types and tiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Accept more file types, make browser-generated previews, and offer a Tiles view.

**Architecture:** `detect_document(data, file_name)` replaces `sniff_document`; migration `0012` widens the type check and adds `document_previews`; previews are made in the browser and stored by `PUT /api/documents/{id}/preview`; a per-account `documents_view` preference drives a List/Tiles view menu.

**Tech Stack:** FastAPI, Alembic, React, `pdfjs-dist` (new, front end only), vitest, pytest.

**Spec:** `docs/superpowers/specs/2026-11-24-documents-tiles-types-design.md`

## Global Constraints
- Limits unchanged (50 MB, 500 documents, 2 GB); previews at most 100 KB server-side, 60 KB aimed at in the browser.
- Types decided by contents; text by extension plus UTF-8/NUL check; no SVG, archives, HTML or scripts.
- Inline only for PDF, browser-drawable images and text; all else attachment. Headers `nosniff`, `sandbox`, `private, no-store` on files.
- A document you may not see has no preview either (404, same rule as the file, applied in SQL).
- Migration `0012` by hand; models in step; `kmk_app` grants; three locales, identical keys; commit trailer as usual.

## Review Focus
- A zip that only looks like an Office file, an ODF with a wrong `mimetype`, an HTML file named `.txt`, a binary named `.md`: refused.
- A preview upload that is not a JPEG, or is over 100 KB: refused and nothing stored.
- Hidden documents: no preview via the API, and `has_preview` never leaks.
- A failed preview must not fail or roll back the upload; a replaced file must not keep the old preview.
- Attachment-only types never open inline, even without `?download=1`.

---

### Task 1: File types (backend)
**Files:** Modify `backend/app/documents/files.py`, `backend/app/documents/service.py`, `backend/app/documents/routes.py`, `backend/alembic/versions/0012_document_types_previews.py` (create), `backend/tests/test_documents_visibility.py`, `backend/tests/test_documents_files.py`; create `backend/tests/test_document_types.py`.
**Interfaces:** `detect_document(data: bytes, file_name: str) -> str | None` (true content type); `INLINE_TYPES: frozenset[str]`; `served_type(content_type) -> str`.
- [ ] Step 1: failing tests in `test_document_types.py` (real bytes built in the test: minimal zips with `zipfile`, ISO-BMFF headers, TIFF, GIF, BMP, OLE magic, RTF, text by extension) plus serving tests (inline for pdf/png/txt, attachment for docx/heic).
- [ ] Step 2: run, expect FAIL. Step 3: implement; migration 0012 widens `documents_content_type` (the full list). Step 4: run `test_document_types.py test_documents_files.py test_documents_visibility.py test_schema_documents.py`. Step 5: commit.

### Task 2: Previews (backend)
**Files:** Modify migration 0012, `backend/app/models.py`, `backend/app/documents/service.py`, `routes.py`; create `backend/tests/test_document_previews.py`.
**Interfaces:** `PUT /api/documents/{id}/preview` (raw JPEG, 204), `GET /api/documents/{id}/preview`, payload field `has_preview: bool`.
- [ ] Tests first: JPEG only, 100 KB cap (patch constant), manage rights, visibility 404 for GET/PUT, replace, cascade on delete, replacing the file drops the preview, ETag/304, `has_preview` in list/get, guard test. Then implement, run, commit.

### Task 3: Previews and types in the browser
**Files:** Create `frontend/src/documents/{fileKind.ts,previews.ts,pdfPreview.ts}` and tests; modify `prepareDocument.ts`, `api.ts`, `hooks.ts`, `DocumentDialog.tsx`, locales, `package.json` (`pdfjs-dist`).
**Interfaces:** `fileKind(contentType: string | null, name: string | null): { icon: string; inline: boolean }`; `makePreview(file: File): Promise<Blob | null>`; `renderPdfPage(data: ArrayBuffer): Promise<Blob | null>` (mocked in tests); `uploadPreview(id, blob, csrf): Promise<void>`.
- [ ] Tests first for accept list/extension rules, icons, text preview drawing (canvas stubbed), upload order (file, then preview; preview failure ignored). Implement, run, commit.

### Task 4: View preference and tiles
**Files:** Modify `backend/app/preferences.py` and its test; `frontend/src/preferences.tsx`, `tasks/ViewMenuButton.tsx` (generalize labels), `documents/DocumentsPage.tsx`; create `documents/DocumentTile.tsx`, `useDocumentsView.ts`, tests, css.
**Interfaces:** preference `documents_view: "list" | "tiles"` (default `list`).
- [ ] Backend test first, then the frontend: View menu, tiles with preview or icon, dialog shows preview, Open hidden for attachment-only types. Commit.

### Task 5: Docs and verification
- [ ] Update `docs/README.md`, `docs/security.md`, `docs/operations.md`, `CLAUDE.md` layout line; `npm audit` for the new dependency; full backend (background, alone) and frontend suites; build; check the PDF worker asset in `dist`; screenshots. Commit.
