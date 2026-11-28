# Visit check-in and check-out Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cleaners check in and out of a visit (one occurrence of an Agenda item with a property), with photos filed by room,
corrections that never erase the original, a per-person "Visits done" report with CSV for paying, and a "no check-out" hint
on the billable list.

**Architecture:** A new backend package `app/visits/` (rules, storage of photo files on disk, routes) on top of seven new
tables (migration `0024`); photo bytes live in a host folder mounted into the API container, only their rows in Postgres.
The frontend gets a `visits/` folder (Visits today page, report page, photo preparation) and small additions to the
property dialog, the Agenda event dialog and the Bill dialog. Backups snapshot the photo folder with `rsync --link-dest`;
a CLI command run by a systemd user timer deletes photos after 6 months.

**Tech Stack:** FastAPI, SQLAlchemy 2, Postgres (hand-written SQL migrations), Pillow (already installed) for decoding
checks, React + TanStack Query, Vitest, bash + rsync + systemd user units.

**Spec:** `docs/superpowers/specs/2026-11-28-visit-checkin-design.md` (read it first; this plan does not repeat the why).

## Global Constraints

- Every new route uses `Depends(guard())` (reads: `guard(csrf=False)`); `tests/test_mfa_guard.py` must keep passing with no new entry in `PUBLIC`.
- Authority rules go in `backend/app/auth/policy.py`; error bodies are `{"error": "<code>"}`.
- Audit rows only through `audit.log(...)`; never log photo bytes, file paths or reasons longer than needed.
- Migration `0024` is hand-written SQL; `app/models.py` kept in step; `kmk_app` gets `SELECT, INSERT` only on `visit_corrections` (append-only) and `SELECT, INSERT, UPDATE, DELETE` on the other new tables.
- Company time zone `America/Toronto` (`app.schedule.service.COMPANY_TZ`); the server clock is the only clock.
- Photos: WebP (JPEG fallback), longest side **1280 px**, at most **600 KB** each (`MAX_PHOTO_BYTES = 600 * 1024`), kept **6 months** (`PHOTO_RETENTION_DAYS = 183`).
- Disk guard: refuse uploads with `503 {"error": "storage_full"}` when the photo folder's disk has less than **1 GiB** free.
- Correction window: until the end of the day **after** the visit's date, company time zone; admins any time.
- No GPS, no hours computed, no pay amounts, no offline mode, no videos, no self check-in for people not listed.
- New UI strings in all four locale files (`fr-CA`, `en`, `pt-BR`, `es`); visit keys start with `vis`.
- Raise the minor version to `0.6.0` in `frontend/package.json` and `backend/pyproject.toml`.
- Run tests per the project policy: the task's own test files while working, `pytest -q --testmon` for side effects, the full `pytest -q` plus `npx vitest run && npm run build` before each commit that touches several areas, and always the full suite for Task 8 (shell scripts).
- Commit at the end of each task with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A Staff member reaches a visit that does not list them** (guessing `event_id`/date in the URL, or a photo id): every visit and photo route answers `404 not_found`, exactly like a missing one. Test in Task 3 and Task 4.
2. **The Agenda changes under a visit** (occurrence moved, people removed, event or property deleted after a check-in): the visit, its people and its photos stay readable by admins with the copied names; a person removed from the Agenda can no longer check in but their existing check-in stays. Test in Task 3.
3. **Two people press Check-out at the same moment, or Check-in twice**: one close wins, the other gets `409 already_closed`; a second check-in of the same person is `409 already_checked_in`, never a duplicate row. Test in Task 3.
4. **A photo upload that is not really an image or is too big** (a renamed PDF, a 5 MB original from an old phone whose browser could not resize): `422 invalid_photo` / `422 photo_too_large`, no file left on disk. Test in Task 4.
5. **The correction window at its edge** (23:59 the next day vs 00:00 the day after, in Toronto time, including the DST change on 2026-11-01): allowed before, `403 correction_window_closed` after, admins always allowed. Test in Task 5.

---

## File Structure

Backend (new package `backend/app/visits/`):
- `limits.py` - the constants above.
- `schemas.py` - request bodies (`CheckInIn`, `CheckOutIn`, `SkipIn`, `CorrectionIn`, `RoomsIn`).
- `service.py` - visits: find/create, check-in, check-out, payloads, visibility.
- `corrections.py` - the window and every correction kind.
- `storage.py` - photo files on disk (save, open, delete, free space, orphan sweep).
- `photos.py` - photo rules (validate bytes, add, remove, skip rooms).
- `report.py` - "Visits done" counts, detail and CSV.
- `purge.py` - retention (used by the CLI).
- `routes.py` - all `/api/visits...` and `/api/visit-photos...` routes.
- Modified: `models.py`, `config.py` (`visit_photos_dir`), `main.py` (router), `auth/policy.py`, `clients/schemas.py` + `clients/service.py` + `clients/routes.py` (rooms, `photos_required`), `invoices/billing.py` (`checked_out`), `cli.py` (`purge-visit-photos`).
- `backend/alembic/versions/0024_visits.py`.

Tests: `test_schema_visits.py`, `test_property_rooms_api.py`, `test_visits_api.py`, `test_visit_photos_api.py`, `test_visit_corrections_api.py`, `test_visits_report_api.py`, `test_visit_purge.py`; additions to `test_invoice_billing.py`, `test_deploy_config.py`, `test_backup_scripts.py`, `test_schema_permissions.py`.

Deploy: `deploy/docker-compose.yml` (volume + env), `deploy/caddy/Caddyfile` (photo body cap), `deploy/backup/kmk-backup.sh` + `lib.sh` (photo snapshots), `deploy/backup/install.sh` + `deploy/backup/systemd/kmk-visit-photos-purge.{service,timer}`, `.gitignore` (`deploy/data/`).

Frontend (new folder `frontend/src/visits/`): `api.ts`, `hooks.ts`, `preparePhoto.ts` (+ test), `VisitsTodayPage.tsx`, `VisitCard.tsx`, `CheckInDialog.tsx`, `PhotoRooms.tsx`, `CorrectionDialog.tsx`, `VisitsReportPage.tsx`, `visits.css`, `Visits.test.tsx`; modified: `App.tsx`, `Shell.tsx`, `app/Nav.tsx`, `clients/PropertyDialog.tsx`, `schedule/` event dialog, `invoices/BillDialog.tsx`, the four locale files.

---

### Task 1: Tables (migration 0024) and models

**Files:**
- Create: `backend/alembic/versions/0024_visits.py`, `backend/tests/test_schema_visits.py`
- Modify: `backend/app/models.py`, `backend/tests/test_schema_permissions.py`

**Interfaces:**
- Produces (SQL and ORM classes `PropertyRoom`, `Visit`, `VisitPerson`, `VisitPhoto`, `VisitRoomSkip`, `VisitCorrection`, plus `Property.photos_required`):
  - `properties.photos_required boolean NOT NULL DEFAULT false`
  - `property_rooms(id bigint identity PK, property_id bigint NOT NULL FK properties ON DELETE CASCADE, name text NOT NULL CHECK length 1..60, position int NOT NULL, UNIQUE(property_id, position))`
  - `visits(id bigint identity PK, event_id bigint NULL FK events ON DELETE SET NULL, occurrence_date date NOT NULL, visit_date date NOT NULL, client_id bigint NULL FK clients SET NULL, property_id bigint NULL FK properties SET NULL, client_name text NULL, property_name text NOT NULL, closed_at timestamptz NULL, closed_by bigint NULL FK users SET NULL, closed_without_photos boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now())`, `UNIQUE(event_id, occurrence_date)`, index on `visit_date`
  - `visit_people(id bigint identity PK, visit_id FK visits CASCADE, user_id bigint NULL FK users SET NULL, user_name text NOT NULL, checked_in_at timestamptz NOT NULL DEFAULT now(), checked_in_by bigint NULL FK users SET NULL, withdrawn_at timestamptz NULL, withdrawn_by bigint NULL FK users SET NULL)`, partial unique index `(visit_id, user_id) WHERE withdrawn_at IS NULL`
  - `visit_photos(id bigint identity PK, visit_id FK visits CASCADE, file_id text NOT NULL UNIQUE, room_id bigint NULL FK property_rooms SET NULL, room_name text NOT NULL CHECK length 1..60, content_type text NOT NULL CHECK in ('image/webp','image/jpeg'), size int NOT NULL CHECK 1..614400, sha256 text NOT NULL, uploaded_by bigint NULL FK users SET NULL, uploaded_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz NULL, deleted_by bigint NULL FK users SET NULL, purged_at timestamptz NULL)`
  - `visit_room_skips(id bigint identity PK, visit_id FK visits CASCADE, room_id bigint NULL FK property_rooms SET NULL, room_name text NOT NULL, reason text NOT NULL CHECK length 1..200, skipped_by bigint NULL FK users SET NULL, skipped_at timestamptz NOT NULL DEFAULT now())`
  - `visit_corrections(id bigint identity PK, visit_id FK visits CASCADE, kind text NOT NULL CHECK in ('close','withdraw','add_person','add_photo','remove_photo','skip_room','reopen'), actor_id bigint NULL FK users SET NULL, reason text NOT NULL CHECK length 1..200, details jsonb NULL, created_at timestamptz NOT NULL DEFAULT now())`
  - Grants as in Global Constraints; `downgrade()` drops the tables and the column.

- [ ] **Step 1: Write the failing schema tests** in `test_schema_visits.py`: `test_visit_unique_per_occurrence` (second insert of the same `(event_id, occurrence_date)` raises `IntegrityError`), `test_one_active_checkin_per_person` (two rows with `withdrawn_at` NULL for the same visit and user raise; after setting `withdrawn_at` on the first, a new one is accepted), `test_visit_survives_event_and_property_deletion` (delete the event and the property: the visit row remains with `event_id` and `property_id` NULL and `property_name` unchanged), `test_photo_size_and_type_are_checked` (size 614401 and `image/png` raise). In `test_schema_permissions.py` add `test_app_role_cannot_change_visit_corrections` (as `app_engine`: INSERT and SELECT work; UPDATE and DELETE raise `ProgrammingError`).
- [ ] **Step 2: Run** `cd backend && .venv/bin/pytest -q tests/test_schema_visits.py tests/test_schema_permissions.py` - Expected: FAIL (tables do not exist).
- [ ] **Step 3: Write `0024_visits.py`** (`revision = "0024"`, `down_revision = "0023"`, one `op.execute` of explicit SQL) and the matching ORM classes in `models.py`.
- [ ] **Step 4: Run** the same command - Expected: PASS. Then `.venv/bin/pytest -q tests/test_schema_*.py` - Expected: PASS.
- [ ] **Step 5: Commit** `feat(visits): tables for visits, check-ins, photos, room skips and corrections`.

### Task 2: Rooms and "Photos required" on properties

**Files:**
- Modify: `backend/app/clients/schemas.py`, `backend/app/clients/service.py`, `backend/app/clients/routes.py`
- Create: `backend/tests/test_property_rooms_api.py`

**Interfaces:**
- Consumes: Task 1 tables.
- Produces: `PropertyIn.photos_required: bool = False`; `property_payload()` adds `"photos_required": bool` and `"rooms": [{"id": int, "name": str}]` (ordered by `position`) for everyone who can read the property; `RoomsIn(BaseModel)` with `rooms: list[RoomIn]` (max 30), `RoomIn = {id: int | None, name: str (trimmed, 1..60)}`; `service.set_rooms(db, actor, property_id, data: RoomsIn, ip) -> list[PropertyRoom]` (keeps ids that are sent, deletes rooms left out, inserts rooms with `id=None`, rewrites `position` in list order; admins only through `policy.check_clients`; audit action `property_rooms_changed`); route `PUT /api/properties/{property_id}/rooms` returning `{"rooms": [...]}`.

- [ ] **Step 1: Write the failing tests:** `test_admin_sets_rooms_in_order_and_keeps_ids` (PUT three names, PUT again with the second renamed and the first removed: the renamed one keeps its id, order follows the list), `test_rooms_and_photos_required_come_with_the_property` (client detail shows `rooms` and `photos_required`), `test_staff_cannot_change_rooms` (`403`), `test_bad_rooms_are_refused` (parametrized: empty name, 61 characters, 31 rooms, unknown id of another property -> `422`), `test_photos_required_is_saved` (PATCH with `photos_required: true` then read back).
- [ ] **Step 2: Run** `.venv/bin/pytest -q tests/test_property_rooms_api.py` - Expected: FAIL.
- [ ] **Step 3: Implement** the schema fields, `set_rooms`, the payload keys and the route.
- [ ] **Step 4: Run** the test file and `tests/test_properties_api.py tests/test_clients_api.py tests/test_mfa_guard.py` - Expected: PASS.
- [ ] **Step 5: Commit** `feat(visits): rooms and photos-required on properties`.

### Task 3: Visits, check-in and check-out (no photos yet)

**Files:**
- Create: `backend/app/visits/__init__.py`, `limits.py`, `schemas.py`, `service.py`, `routes.py`, `backend/tests/test_visits_api.py`
- Modify: `backend/app/auth/policy.py`, `backend/app/main.py`

**Interfaces:**
- Consumes: `app.invoices.billing.occurrence_of(db, event, original) -> Occurrence | None`, `app.schedule.service.COMPANY_TZ`, `policy.PRIVILEGED`.
- Produces:
  - `policy.can_see_visit(actor: User, listed_ids: frozenset[int], checked_in_ids: frozenset[int]) -> bool` (admins; or actor in either set) and `policy.check_visit_admin(actor) -> None` (`403 forbidden` unless privileged).
  - `service.today(db, actor, now: datetime) -> list[dict]`: occurrences of today (company date) of events with a `property_id` that list the actor, sorted by start time, each as `visit_payload` (a visit not started yet has `"id": None`, `"state": "not_started"`).
  - `service.get_visit(db, actor, event_id: int, occurrence_date: date) -> dict` (`404 not_found` when the occurrence does not exist, has no property, is cancelled, or the actor may not see it).
  - `service.check_in(db, actor, event_id, occurrence_date, people: list[int], now, ip) -> dict`: creates the `visits` row on first check-in (copies `visit_date`, client and property names), inserts one `visit_people` row per person with `checked_in_by = actor.id`. Errors: `403 not_listed` (actor or a person not listed on the event), `409 already_checked_in`, `409 already_closed`, `422 not_today` (company date is not the occurrence's actual date). The actor must be among `people` or already checked in.
  - `service.check_out(db, actor, event_id, occurrence_date, confirm_no_photos: bool, now, ip) -> dict`: actor must be checked in (`403 not_checked_in`); `409 already_closed`; when the property has `photos_required` and a room has neither an active photo nor a skip -> `409 rooms_missing` with `"rooms": [names]`; when there is no active photo and `confirm_no_photos` is false -> `409 no_photos`; sets `closed_at`, `closed_by`, `closed_without_photos`. Lock the visit row (`SELECT ... FOR UPDATE`) in check-in and check-out.
  - `visit_payload` keys: `id, event_id, occurrence_date, date, title, client_name, property_name, property_id, photos_required, rooms, state` (`not_started|in_progress|closed`), `people` (`[{user_id, name, checked_in_at, checked_in_by_name, self: bool}]`, active only), `listed` (`[{user_id, name}]`), `closed_at, closed_by_name, closed_without_photos, corrected: bool, photos: []` (filled by Task 4), `skips: []`, `corrections: []` (Task 5), `can_correct_until` (Task 5; `None` here).
  - Routes (prefix `/api/visits`): `GET /today`, `GET /{event_id}/{occurrence_date}`, `POST /{event_id}/{occurrence_date}/checkin` body `{"people": [int]}`, `POST /{event_id}/{occurrence_date}/checkout` body `{"confirm_no_photos": bool}`. Audit actions `visit_checkin`, `visit_checkout`.

- [ ] **Step 1: Write the failing tests** (an admin creates a client, a property and an event with `property_id`, `people=[ana, bruno, carla]`, `start_date` = the patched company today; patch `service.now`): `test_today_lists_my_visits_only`, `test_first_arrival_checks_in_self_and_colleagues` (payload shows `checked_in_by_name` and `self`), `test_late_arrival_checks_in_self`, `test_person_not_listed_cannot_check_in_or_be_marked` (`403 not_listed`), `test_check_in_twice_is_409`, `test_not_today_is_422`, `test_checkout_by_any_checked_in_person_closes_for_all`, `test_checkout_without_photos_needs_confirmation` (`409 no_photos`, then `confirm_no_photos: true` closes with `closed_without_photos` true), `test_photos_required_blocks_checkout_with_missing_rooms` (`409 rooms_missing`, names listed), `test_second_checkout_is_409`, `test_no_checkin_after_close`, `test_staff_not_on_visit_gets_404` (Review Focus 1), `test_visit_survives_agenda_changes` (Review Focus 2: after check-in, remove a person from the event, delete the property: admin still reads the visit with names; the removed person cannot check in), `test_event_without_property_has_no_visit` (`404`).
- [ ] **Step 2: Run** `.venv/bin/pytest -q tests/test_visits_api.py` - Expected: FAIL.
- [ ] **Step 3: Implement** `limits.py`, the policy functions, `schemas.py` (`CheckInIn`, `CheckOutIn`, both `extra="forbid"`), `service.py`, `routes.py`, and register `visits_router` in `main.py`. `now()` is a module function `service.now() -> datetime` (UTC) so tests can patch it.
- [ ] **Step 4: Run** the test file and `tests/test_mfa_guard.py` - Expected: PASS.
- [ ] **Step 5: Commit** `feat(visits): check-in and check-out of a visit`.

### Task 4: Photo files, upload, view, delete and room skips

**Files:**
- Create: `backend/app/visits/storage.py`, `backend/app/visits/photos.py`, `backend/tests/test_visit_photos_api.py`
- Modify: `backend/app/config.py`, `backend/app/visits/routes.py`, `backend/app/visits/service.py` (fill `photos`, `skips`), `deploy/docker-compose.yml`, `deploy/caddy/Caddyfile`, `.gitignore`, `backend/tests/test_deploy_config.py`

**Interfaces:**
- Consumes: Task 3 `service.get_visit` visibility and row lock, `app.documents.uploads.read_capped(request, limit, error)` and a new `Slots(maximum=2)` instance.
- Produces:
  - `Settings.visit_photos_dir: str = "/data/visit-photos"`; tests pass `make_settings(visit_photos_dir=str(tmp_path))`.
  - `storage.save(root: Path, data: bytes) -> str` (new random `file_id = secrets.token_hex(16)`, path `root/<id[:2]>/<id>`, write to `<path>.tmp` then `os.replace`, mode 600), `storage.open_bytes(root, file_id) -> bytes`, `storage.delete(root, file_id) -> None` (no error if missing), `storage.free_bytes(root) -> int` (`shutil.disk_usage`), `storage.all_ids(root) -> set[str]`. `file_id` is validated against `^[0-9a-f]{32}$` before building any path.
  - `photos.validate(data: bytes) -> str` returns `"image/webp"` or `"image/jpeg"` from the magic bytes and a successful `PIL.Image.open(...).verify()`; else `422 invalid_photo`.
  - `photos.add(db, settings, actor, event_id, occurrence_date, data, room_id: int | None, other_name: str | None, now, ip) -> dict` (actor checked in, visit open; else Task 5 handles it with a reason): free space below `1 GiB` -> `503 storage_full`; room must belong to the visit's property; `other_name` 1..60 when `room_id` is None. Row inserted after the file is saved; on any DB error the file is deleted.
  - `photos.remove(db, settings, actor, photo_id, now, ip)`: only the uploader, only while open; sets `deleted_at/deleted_by`, then deletes the file.
  - `photos.skip(db, actor, event_id, occurrence_date, room_id, reason, now, ip)`.
  - Routes: `PUT /api/visits/{event_id}/{occurrence_date}/photos?room_id=&other_name=` (raw body, cap `MAX_PHOTO_BYTES`, `422 photo_too_large`), `GET /api/visit-photos/{photo_id}` (bytes with the stored content type, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`; `404` when deleted, purged or not visible), `DELETE /api/visit-photos/{photo_id}`, `POST /api/visits/{event_id}/{occurrence_date}/skips` body `{"room_id": int, "reason": str}`. Audit actions `visit_photo_added`, `visit_photo_removed`, `visit_room_skipped` (details: visit id and room name only).
  - Payload `photos`: `[{id, room_id, room_name, uploaded_by_name, uploaded_at, url: "/api/visit-photos/<id>"}]` (active only) and `photo_count_total` (including removed and purged).
  - Compose: `api.volumes: ["./data/visit-photos:/data/visit-photos"]`, `api.environment.VISIT_PHOTOS_DIR: /data/visit-photos`; the folder `deploy/data/visit-photos/` is git-ignored and must be owned by uid 10001 (documented in Task 9).
  - Caddyfile: a `@visitphoto` matcher (`method PUT`, `path_regexp ^/api/visits/[0-9]+/[0-9-]+/photos$`) with `max_size 768KB`, placed before `handle /api/*`.

- [ ] **Step 1: Write the failing tests:** `test_upload_view_and_delete_a_photo` (a tiny real WebP made with Pillow; GET returns the same bytes and the headers above; DELETE then GET is `404`), `test_photo_is_filed_under_a_room_or_other`, `test_not_an_image_is_refused_and_leaves_no_file` (PDF bytes with a `.webp` name -> `422 invalid_photo`, `storage.all_ids` empty; Review Focus 4), `test_too_large_is_refused` (614401 bytes -> `422 photo_too_large`), `test_room_of_another_property_is_refused`, `test_low_disk_answers_storage_full` (patch `storage.free_bytes` to `1024**3 - 1` -> `503`), `test_only_the_uploader_removes_and_only_while_open`, `test_photo_of_a_visit_i_cannot_see_is_404` (Review Focus 1), `test_skip_counts_for_photos_required` (skip the missing room, checkout then succeeds). In `test_deploy_config.py`: `test_visit_photos_have_their_own_body_cap` (matcher, regex and `max_size 768KB` present once; `MAX_PHOTO_BYTES < 768 * 1000`; the other caps' counts unchanged) and extend the compose test so `VISIT_PHOTOS_DIR` is in `api.environment` and the volume is mounted only on `api`.
- [ ] **Step 2: Run** `.venv/bin/pytest -q tests/test_visit_photos_api.py tests/test_deploy_config.py` - Expected: FAIL.
- [ ] **Step 3: Implement** the setting, `storage.py`, `photos.py`, the routes, the payload fields, the compose and Caddyfile changes, and add `deploy/data/` to `.gitignore`.
- [ ] **Step 4: Run** the two files plus `tests/test_visits_api.py tests/test_mfa_guard.py` - Expected: PASS.
- [ ] **Step 5: Commit** `feat(visits): photos by room, stored on disk`.

### Task 5: Corrections

**Files:**
- Create: `backend/app/visits/corrections.py`, `backend/tests/test_visit_corrections_api.py`
- Modify: `backend/app/visits/schemas.py`, `backend/app/visits/routes.py`, `backend/app/visits/service.py` (`corrections`, `corrected`, `can_correct_until`), `backend/app/visits/photos.py` (accept a correction after close)

**Interfaces:**
- Consumes: Tasks 3 and 4.
- Produces:
  - `corrections.window_end(visit_date: date) -> datetime`: `datetime.combine(visit_date + timedelta(days=2), time(0, 0), COMPANY_TZ)` (the first instant after the next day).
  - `corrections.may_correct(actor: User, visit: Visit, checked_in_ids: frozenset[int], now: datetime) -> bool`: admins always; else actor was checked in on the visit (active or withdrawn) and `now < window_end(visit.visit_date)`.
  - `CorrectionIn`: `kind` (one of `close`, `withdraw`, `add_person`, `reopen`), `reason` (trimmed, 1..200), `user_id: int | None` (required for `withdraw` and `add_person`).
  - `corrections.apply(db, actor, event_id, occurrence_date, data: CorrectionIn, now, ip) -> dict`: `close` (open visit; same photo rules as check-out but `confirm_no_photos` implied by the reason), `withdraw` (sets `withdrawn_at/by` on the person's active row), `add_person` (a listed person, after the close or after the day; `checked_in_by = actor`), `reopen` (admins only; clears `closed_at`, `closed_by`, `closed_without_photos`). Every call inserts one `visit_corrections` row and an audit row `visit_corrected` (details: visit id, kind). Errors: `403 correction_window_closed`, `403 forbidden` (reopen by Staff), `409` for impossible states (`not_closed`, `already_closed`, `not_checked_in`).
  - After the close, photo add/remove and skip require a query/body field `reason` and record a correction of kind `add_photo`, `remove_photo` or `skip_room`; without `reason` they answer `409 already_closed`.
  - Route: `POST /api/visits/{event_id}/{occurrence_date}/corrections`.
  - Payload: `corrections: [{kind, actor_name, reason, created_at, details}]` newest first, `corrected: bool`, `can_correct_until: iso datetime | None` (None for admins).
  - The day-after rule also lets a listed person check in late through `add_person` when the visit was never started (it creates the visit).

- [ ] **Step 1: Write the failing tests:** `test_forgotten_checkout_is_closed_by_correction` (next day, reason required, payload shows the correction and `corrected`), `test_correction_needs_a_reason` (`422`), `test_window_edge_in_toronto_time` (Review Focus 5: visit on 2026-11-01, patched `now` at 2026-11-02 23:59 Toronto -> allowed; 2026-11-03 00:00 -> `403 correction_window_closed`; admin at 2026-12-01 -> allowed), `test_withdraw_a_mistaken_checkin_keeps_the_original_row` (row has `withdrawn_at`, original `checked_in_at` unchanged, person no longer counted), `test_add_person_after_close`, `test_only_admins_reopen`, `test_photo_after_close_needs_reason_and_is_recorded`, `test_someone_never_checked_in_cannot_correct`, `test_corrections_are_append_only_for_the_app_role` (try an UPDATE through `app_engine` -> `ProgrammingError`).
- [ ] **Step 2: Run** `.venv/bin/pytest -q tests/test_visit_corrections_api.py` - Expected: FAIL.
- [ ] **Step 3: Implement** `corrections.py`, the schema, the route and the payload fields; adjust `photos.py`.
- [ ] **Step 4: Run** the file plus `tests/test_visits_api.py tests/test_visit_photos_api.py` - Expected: PASS.
- [ ] **Step 5: Commit** `feat(visits): corrections that keep the original`.

### Task 6: "Visits done" report, CSV, and the billing hint

**Files:**
- Create: `backend/app/visits/report.py`, `backend/tests/test_visits_report_api.py`
- Modify: `backend/app/visits/routes.py`, `backend/app/invoices/billing.py`, `backend/tests/test_invoice_billing.py`

**Interfaces:**
- Consumes: Tasks 1-5.
- Produces:
  - `report.summary(db, frm: date, to: date) -> dict`: `{"people": [{"user_id", "name", "visits": int, "corrected": int, "without_photos": int}], "open": [visit_payload-lite]}` where a person counts once per **closed** visit with `visit_date` in range on which they have an active check-in; sorted by name; `open` lists visits in range with check-ins and no close.
  - `report.person(db, user_id, frm, to) -> list[dict]` rows `{date, client_name, property_name, checked_in_at, closed_at, photos, without_photos, corrected, checked_in_by_name}`.
  - `report.csv_text(db, frm, to) -> str`: header `date,person,client,property,check_in,check_out,photos,closed_without_photos,corrected,checked_in_by`, one line per person and visit, times in company time `HH:MM`, values quoted with `csv.writer`; cells starting with `=`, `+`, `-` or `@` are prefixed with `'` (spreadsheet formula injection).
  - Routes (admins only via `policy.check_visit_admin`): `GET /api/visits/report?from=&to=`, `GET /api/visits/report/{user_id}?from=&to=`, `GET /api/visits/report.csv?from=&to=` (`text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="visites-<from>-<to>.csv"`). Range at most 366 days (`422 range_too_long`).
  - `billing.billable(...)` adds `"checked_out": bool` to each occurrence (True when a `visits` row for `(event_id, occurrence_date)` has `closed_at`).

- [ ] **Step 1: Write the failing tests:** `test_counts_per_person_for_closed_visits_only`, `test_withdrawn_person_is_not_counted`, `test_open_visits_are_listed_apart`, `test_person_detail_lists_markers`, `test_csv_columns_and_formula_guard` (a client named `=HYPERLINK(...)` comes out as `'=HYPERLINK(...)`), `test_report_is_for_admins_only` (Staff `403`), `test_range_too_long`; in `test_invoice_billing.py`: `test_billable_marks_visits_without_checkout`.
- [ ] **Step 2: Run** `.venv/bin/pytest -q tests/test_visits_report_api.py tests/test_invoice_billing.py` - Expected: FAIL.
- [ ] **Step 3: Implement** `report.py`, the routes and the `checked_out` key.
- [ ] **Step 4: Run** the two files plus `tests/test_invoices_api.py tests/test_mfa_guard.py` - Expected: PASS.
- [ ] **Step 5: Commit** `feat(visits): visits done report, CSV and the billing hint`.

### Task 7: Retention (purge command)

**Files:**
- Create: `backend/app/visits/purge.py`, `backend/tests/test_visit_purge.py`
- Modify: `backend/app/cli.py`

**Interfaces:**
- Consumes: `storage.delete`, `storage.all_ids`, `limits.PHOTO_RETENTION_DAYS`.
- Produces: `purge.run(db, root: Path, today: date) -> dict` returning `{"purged": int, "orphans": int}`: for photos with `purged_at IS NULL` whose visit's `visit_date < today - 183 days`, delete the file and set `purged_at`; then delete files whose id has no row (orphans) **only if older than 1 hour** (file mtime) so an upload in progress is never removed. CLI `python -m app.cli purge-visit-photos` prints the dict as `purged=N orphans=M` and uses `Settings.visit_photos_dir`.

- [ ] **Step 1: Write the failing tests:** `test_old_photos_are_purged_and_the_row_stays` (row has `purged_at`, `photo_count_total` unchanged, GET is `404`), `test_recent_photos_stay`, `test_orphan_files_are_removed_but_not_fresh_ones`, `test_cli_runs_the_purge` (invoke `purge-visit-photos` the same way `tests/test_cli.py` invokes the other subcommands, with the photo folder pointing to `tmp_path`).
- [ ] **Step 2: Run** `.venv/bin/pytest -q tests/test_visit_purge.py` - Expected: FAIL.
- [ ] **Step 3: Implement** `purge.py` and the CLI subcommand (`help="delete visit photos older than 6 months and files with no row"`).
- [ ] **Step 4: Run** the file and `tests/test_cli.py` - Expected: PASS.
- [ ] **Step 5: Commit** `feat(visits): delete photos after 6 months`.

### Task 8: Backups of the photos and the purge timer

**Files:**
- Modify: `deploy/backup/lib.sh`, `deploy/backup/kmk-backup.sh`, `deploy/backup/install.sh`, `backend/tests/test_backup_scripts.py`
- Create: `deploy/backup/systemd/kmk-visit-photos-purge.service`, `deploy/backup/systemd/kmk-visit-photos-purge.timer`

**Interfaces:**
- Produces: `lib.sh` setting `KMK_BACKUP_PHOTOS_SRC` (default `$REPO_DIR/deploy/data/visit-photos`; an empty value or a missing folder skips the step with a log line, never a failure). After the database archive is written, `kmk-backup.sh` runs `rsync -a --link-dest=<previous snapshot> "$SRC/" "$DEST/photos/<same timestamp as the archive>.partial/"`, renames it without `.partial`, and prunes `photos/` to the newest `KMK_BACKUP_KEEP_DAILY` by name (same rule and never the new one). A failure of the photo step records `failed` like any other step. The status `message` becomes `backup written (photos: <n> files)`.
- The purge service runs `docker compose -f @REPO@/deploy/docker-compose.yml exec -T api python -m app.cli purge-visit-photos`; the timer `OnCalendar=*-*-* 03:15:00`, `Persistent=true`, `RandomizedDelaySec=10min`. `install.sh`'s `UNITS` gains both.

- [ ] **Step 1: Write the failing tests** in `test_backup_scripts.py`: `test_photos_are_snapshotted_with_hard_links` (two runs on different `KMK_BACKUP_NOW`: two snapshot folders, an unchanged file has the same inode in both), `test_photo_snapshots_follow_the_retention`, `test_missing_photo_folder_is_not_a_failure`, `test_purge_units_are_rendered` (extend `test_units_are_rendered_with_the_repository_path` to five units and check the `ExecStart` and `OnCalendar` above).
- [ ] **Step 2: Run** `.venv/bin/pytest -q tests/test_backup_scripts.py` - Expected: FAIL.
- [ ] **Step 3: Implement** the script, units and installer changes.
- [ ] **Step 4: Run** the full suite `.venv/bin/pytest -q` - Expected: PASS.
- [ ] **Step 5: Commit** `feat(visits): back up the photos and purge them daily`.

### Task 9: Frontend - Visits today, check-in, photos, corrections

**Files:**
- Create: `frontend/src/visits/api.ts`, `hooks.ts`, `preparePhoto.ts`, `preparePhoto.test.ts`, `VisitsTodayPage.tsx`, `VisitCard.tsx`, `CheckInDialog.tsx`, `PhotoRooms.tsx`, `CorrectionDialog.tsx`, `visits.css`, `Visits.test.tsx`
- Modify: `frontend/src/App.tsx`, `frontend/src/Shell.tsx`, `frontend/src/app/Nav.tsx`, the four locale files

**Interfaces:**
- Consumes: Task 3-5 routes and payloads (field names exactly as listed there).
- Produces:
  - `preparePhoto(file: File): Promise<Blob>`: longest side scaled to at most `PHOTO_SIDE = 1280` (never upscaled), redrawn on a canvas (drops metadata including GPS), encoded `image/webp` trying qualities `0.75, 0.65, 0.55, 0.45`; if the browser returns another type, `image/jpeg` with the same qualities; first blob `<= PHOTO_MAX_BYTES = 600 * 1024` wins; otherwise `Error("photo_too_large")`; not an image -> `Error("invalid_image")`.
  - Route `/visits` -> `ShellPage` `"visits"`, nav item `{ id: "visits", to: "/visits", labelKey: "visTitle", icon: "check" }` for everyone.
  - `VisitCard` shows state, the people (`"Ana (herself, 08:02)"`, `"Bruno (marked by Ana, 08:02)"`), Check-in (opens `CheckInDialog` with listed people not yet checked in, self pre-selected), photos grouped by room (`PhotoRooms`: one row per room plus Other, add photo button, a skip button with a reason when `photos_required`), Check-out (on `409 no_photos` shows the warning with *Take photos* / *Close without photos*; on `409 rooms_missing` lists the rooms), and a Correct button while `can_correct_until` is in the future or the user is an admin (`CorrectionDialog`, reason required).
- Locale keys (all four files): `visTitle`, `visToday`, `visNone`, `visCheckIn`, `visCheckOut`, `visWhoIsHere`, `visSelf`, `visMarkedBy`, `visStateNotStarted`, `visStateInProgress`, `visStateClosed`, `visCorrected`, `visAddPhoto`, `visOtherRoom`, `visOtherName`, `visSkipRoom`, `visSkipReason`, `visNoPhotosTitle`, `visNoPhotosBody` (= "Photos are highly recommended: they prove the work was done."), `visTakePhotos`, `visCloseWithoutPhotos`, `visRoomsMissing`, `visCorrect`, `visCorrectionReason`, `visCorrectionClose`, `visCorrectionWithdraw`, `visCorrectionAddPerson`, `visCorrectionReopen`, `visCorrectUntil`, `visErrStorageFull`, `visErrInvalidPhoto`, `visErrPhotoTooLarge`.

- [ ] **Step 1: Write the failing tests:** `preparePhoto.test.ts` (a 4000x3000 picture becomes 1280x960 WebP under the cap; JPEG fallback when the canvas cannot make WebP; `invalid_image` for a text file); `Visits.test.tsx` (lists today's visits; check-in dialog sends `{"people": [...]}` with self pre-selected; no-photos warning flow sends `confirm_no_photos: true` on *Close without photos*; rooms-missing message; Correct hidden after the window for Staff).
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/visits` - Expected: FAIL.
- [ ] **Step 3: Implement** the files, route, nav item and strings.
- [ ] **Step 4: Run** `npx vitest run` (the locale key-set test included) and `npm run build` - Expected: PASS.
- [ ] **Step 5: Commit** `feat(visits): visits today page with check-in, photos and corrections`.

### Task 10: Frontend - property rooms, Agenda state, Bill dialog hint, report page

**Files:**
- Create: `frontend/src/visits/VisitsReportPage.tsx`, `frontend/src/visits/rooms.ts`, `frontend/src/visits/Report.test.tsx`
- Modify: `frontend/src/clients/PropertyDialog.tsx`, the Agenda event dialog in `frontend/src/schedule/`, `frontend/src/invoices/BillDialog.tsx`, `App.tsx`, `Shell.tsx`, `app/Nav.tsx`, the four locale files

**Interfaces:**
- Consumes: Task 2 (`rooms`, `photos_required`, `PUT /api/properties/{id}/rooms`), Task 3 (`GET /api/visits/{event_id}/{date}`), Task 6 (report routes, `checked_out`).
- Produces:
  - `starterRooms(kind: PropertyKind, t: TFunction): string[]` in `rooms.ts`: house -> kitchen, living room, bathroom, bedroom; airbnb -> kitchen, living room, bathroom, bedroom, entrance; commercial/office -> reception, offices, washrooms, kitchenette; other -> kitchen, bathroom (labels from locale keys `visRoomKitchen`, `visRoomLiving`, `visRoomBathroom`, `visRoomBedroom`, `visRoomEntrance`, `visRoomReception`, `visRoomOffices`, `visRoomWashrooms`, `visRoomKitchenette`); offered only when the list is empty.
  - Property dialog (admins): "Photos required" checkbox (`visPhotosRequired`) and an ordered room list editor (add, rename, remove, move up/down) saved with the PUT.
  - Agenda event dialog: for items with a property, a line with the visit state and a "Check-in" button that opens `/visits` (`visOpenVisit`).
  - Bill dialog: occurrences with `checked_out: false` show a warning chip `visNoCheckout` ("no check-out"); still selectable.
  - Route `/visits/report` -> `ShellPage` `"visitsReport"`, nav item for admins (`adminOnly: true`, label `visReportTitle`): date range (default last 14 days), the per-person table, a detail list on click, `visOpenVisits`, and an "Export CSV" link to `/api/visits/report.csv?from=&to=` (`visExportCsv`).

- [ ] **Step 1: Write the failing tests** (`Report.test.tsx` and additions to the existing `Properties.test.tsx`, `BillDialog.test.tsx`): starter rooms offered only when empty; room editor sends the ordered PUT; photos-required checkbox saved; report table renders counts and markers and the CSV link carries the range; Bill dialog shows the no-check-out chip.
- [ ] **Step 2: Run** `npx vitest run src/visits src/clients src/invoices` - Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run && npm run build`, then the backend `pytest -q` - Expected: PASS.
- [ ] **Step 5: Commit** `feat(visits): rooms on properties, Agenda state, billing hint and the report page`.

### Task 11: Docs, version, and a live check

**Files:**
- Modify: `frontend/package.json`, `backend/pyproject.toml` (`0.6.0`), `docs/README.md` (data model tables and the Visits section), `docs/operations.md` (photo folder and its owner `sudo chown 10001:10001 deploy/data/visit-photos`, `VISIT_PHOTOS_DIR`, the purge timer, photos in backup and restore: copy the newest `infrastructure/backups/photos/<snapshot>/` back into `deploy/data/visit-photos/`), `docs/security.md` (photo visibility, metadata stripped, append-only corrections), `docs/roadmap.md` (done; not built by choice: GPS, hours, pay amounts, offline, videos, self check-in of substitutes; future: videos, off-site photos), `CLAUDE.md` (layout line for `backend/app/visits/` and `frontend/src/visits/`), `deploy/.env.example` if it lists API settings.

- [ ] **Step 1: Update** the versions and the docs above.
- [ ] **Step 2: Run** `cd backend && .venv/bin/pytest -q` and `cd frontend && npx vitest run && npm run build` - Expected: all PASS.
- [ ] **Step 3: Hand the owner the deploy steps** (create and chown the folder, `cd deploy && docker compose up -d --build`, `deploy/backup/install.sh`, `docker compose restart caddy`); do not run them without the owner's go-ahead.
- [ ] **Step 4: Commit** `docs(visits): visits module, version 0.6.0`.
