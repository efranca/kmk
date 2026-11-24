# Documents: more file types and tiles with previews

Approved by the owner on 2026-11-24 (with PDF first-page previews through `pdfjs-dist`). Builds on `2026-11-24-documents-design.md`; where they differ, this one wins.

## Intent
The library should take the files a company really keeps (all kinds of images, plain text and Markdown, Office files) and let people browse it as tiles with a small preview, not only as a text list.

## Goals
- **File types, decided by the file's contents** (never by its name or declared type), except text, which has no signature and is accepted by extension *and* a content check:
  - Images: JPEG, PNG, WebP, GIF, AVIF, BMP; HEIC/HEIF and TIFF (stored, shown as an icon because most browsers cannot draw them). No SVG (it can carry scripts).
  - PDF.
  - Text: `.txt .md .markdown .csv .tsv .json .log` (valid UTF-8, no NUL byte), and RTF (`{\rtf` start).
  - Office: DOCX, XLSX, PPTX, ODT, ODS, ODP (a real zip package with the right inner files: `[Content_Types].xml` plus `word/`, `xl/` or `ppt/`; or an ODF `mimetype` entry), and the old DOC, XLS, PPT (OLE container, type by extension).
  - Refused: archives (ZIP and others), programs, scripts, HTML, SVG.
- **Serving.** PDF, browser-drawable images and text open inline (text is sent as `text/plain; charset=utf-8`); everything else (Office, RTF, HEIC, TIFF) is always an attachment. All keep `nosniff`, `Content-Security-Policy: sandbox`, `Cache-Control: private, no-store`. The stored content type stays the true one. The 50 MB / 500 / 2 GB limits are unchanged.
- **Previews.** The browser makes a small JPEG (fits 360x360, at most 60 KB) when a file is added or replaced and sends it to `PUT /api/documents/{id}/preview`; the server accepts only a JPEG up to 100 KB. Images are scaled; text and Markdown are drawn from their first lines; **PDFs get their first page through `pdfjs-dist`** (loaded only when a PDF is chosen, with its worker as a same-origin asset). Office, HEIC and TIFF get no preview (a type icon on the tile). A failed preview never blocks the upload.
- **Where previews live.** New table `document_previews(document_id pk -> documents on delete cascade, data bytea <= 100 KB)`, served by `GET /api/documents/{id}/preview` with the same visibility rule as the file (a hidden document has no preview: 404), `ETag`, `Cache-Control: private, max-age=0, must-revalidate`. The document payload gains `has_preview`. Replacing a file removes the old preview. Documents added before this change have no preview until their file is replaced.
- **Tiles.** The Documents gear becomes a View menu like Tasks: **List / Tiles** and **Manage categories**. The choice is a per-account preference `documents_view` (`list` default). A tile shows the preview (or a type icon), the title, category icon, size and visibility chip; a click opens the same dialog. The dialog shows the preview and offers Open only for inline types, Download always.
- `migration 0012` widens the content-type check and adds the previews table (grants for `kmk_app`).

## Non-goals
Server-side thumbnails or any image library on the server; previews for Office files; SVG; archives; editing text in the app; converting HEIC; generating previews for documents that already exist.

## Approaches
1. **Browser makes the preview (chosen).** No image or PDF library on the server, the server only checks a JPEG's first bytes and size. Cost: a PDF library in the front end, and old documents have no preview.
2. Server renders previews (Pillow, Poppler). Better for old documents, but new native dependencies in the API image and untrusted file parsing on the server. Rejected.
3. Icons only for PDFs (no `pdfjs-dist`). Smaller, but PDFs are most of the library. Rejected by the owner.

## Calls made by me
- Text is accepted by extension because it has no signature; the UTF-8/NUL check keeps binaries out.
- GIFs are not re-encoded when large (it would drop the animation); their preview is the first frame.
- Previews are best effort: if one cannot be made, the tile shows the icon.
- Known risk to verify after deploy: Chrome may refuse an inline PDF under `sandbox` (Download works); the PDF.js worker needs Caddy to serve `.mjs` as JavaScript.

## Tests
Backend: each type accepted from real bytes, each refused kind (fake `.pdf`, `.md` with NUL, HTML, SVG, zip with wrong inner files, ODF with the wrong mimetype); inline vs attachment per type; preview upload (JPEG only, size cap, visibility, replace, cascade, ETag/304, `has_preview`); `documents_view` preference. Frontend: type accept list and icons, preview makers (image, text; PDF through a mocked renderer), upload sends the preview after the file and ignores its failure, the View menu, tiles render preview or icon and open the dialog, Open hidden for attachment-only types.
