"""Photos of a visit and room skips (the routes call these). While a visit is open, on its own day (company date), anyone
checked in adds photos and skips rooms, and a photo is removed only by who uploaded it. After the close, and on a visit
still open after its day, each of these is a correction: the request carries a `reason` (else `409 already_closed`, or
`409 correction_required` for the open visit), the correction authority applies (`corrections.check`: the window, and
only people checked in on the visit or admins), and one `visit_corrections` row is written in the same transaction,
under the same lock. The bytes live on disk (`storage`); the row is the record.

The order of the conditions is the same for the upload (`precheck`, then `add`) and the skip, and lives in `_may_write`
(with `_correction`, which the removal shares): no visit yet -> `403 not_checked_in`; closed or past its day -> `409`
without a reason, else the correction authority; open on its day and the actor not active on it -> `403 not_checked_in`.

Write order: file first, then the row (the file is deleted if the row cannot be saved). Removal: the row is marked
removed first. A plain removal (open visit, its own day) then deletes the file (a file a failed delete leaves behind
goes with the 6-month purge, which purges removed rows too). A removal that is a correction keeps the file until the 6-month purge (ruling R16: the original is never
erased); admins can still open it by id (`policy.can_open_removed_visit_photo`), and the purge deletes it like any old
photo (the row stays).
"""

import hashlib
import io
from datetime import date, datetime
from pathlib import Path

from PIL import Image
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import audit, policy
from app.auth.errors import ApiError
from app.config import Settings
from app.documents.uploads import Slots
from app.models import PropertyRoom, User, Visit, VisitPhoto, VisitRoomSkip
from app.visits import corrections, service, storage
from app.visits.limits import MAX_PHOTO_BYTES, MIN_FREE_BYTES, REASON_MAX, ROOM_NAME_MAX

slots = Slots(maximum=2)  # its own counter: a photo in flight does not take a document upload's place
MAX_PIXELS = 25_000_000  # a small file can still declare a huge picture


def root_of(settings: Settings) -> Path:
    return Path(settings.visit_photos_dir)


def ensure_space(settings: Settings) -> None:
    try:
        free = storage.free_bytes(root_of(settings))
    except OSError:
        raise ApiError(503, "storage_full")
    if free < MIN_FREE_BYTES:
        raise ApiError(503, "storage_full")


def validate(data: bytes) -> str:
    """`image/webp` or `image/jpeg`, decided by the first bytes and then by really opening the picture; else `422 invalid_photo`."""
    if len(data) > MAX_PHOTO_BYTES:
        raise ApiError(422, "photo_too_large")
    if data[:3] == b"\xff\xd8\xff":
        kind, fmt = "image/jpeg", "JPEG"
    elif data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        kind, fmt = "image/webp", "WEBP"
    else:
        raise ApiError(422, "invalid_photo")
    try:
        with Image.open(io.BytesIO(data)) as picture:
            if picture.format != fmt or picture.width * picture.height > MAX_PIXELS:
                raise ApiError(422, "invalid_photo")
            picture.verify()
        with Image.open(io.BytesIO(data)) as picture:  # verify() does not decode JPEG or WebP: really decode (size is capped above)
            picture.load()
    except ApiError:
        raise
    except Exception:  # a damaged or hostile file: Pillow raises many kinds of errors
        raise ApiError(422, "invalid_photo")
    return kind


def _correction(db: Session, actor: User, visit: Visit, reason: str | None, now: datetime) -> str | None:
    """`None` when the change follows the plain rules (an open visit, on its own day: a reason is then ignored). Else the
    change is a correction: closed, or still open after the visit's day (company date). It needs a reason (`409
    already_closed` / `409 correction_required` without one), the correction authority (`403 not_checked_in` / `403
    correction_window_closed`) and a valid reason (`422 invalid_reason`); returns the cleaned reason."""
    closed = visit.closed_at is not None
    if not closed and service.company_date(now) <= visit.visit_date:
        return None
    if reason is None:
        raise ApiError(409, "already_closed" if closed else "correction_required")
    corrections.check(actor, visit, corrections.checked_in_ids(db, visit.id), now)
    return corrections.clean_reason(reason)


def _may_write(db: Session, actor: User, visit: Visit | None, reason: str | None, now: datetime) -> str | None:
    """Whether the actor may add a photo or skip a room on this visit (the one place for the order of the conditions, see
    the module's docstring). Returns the cleaned correction reason when the change is a correction (`_correction`),
    `None` for a plain change."""
    if visit is None:
        raise ApiError(403, "not_checked_in")
    correction = _correction(db, actor, visit, reason, now)
    if correction is None and actor.id not in service._active_ids(db, visit.id):
        raise ApiError(403, "not_checked_in")
    return correction


def _writable_visit(db: Session, actor: User, event_id: int, occurrence_date: date, reason: str | None, now: datetime) -> tuple[Visit, str | None]:
    """The locked visit the actor may write to (404 when they cannot see it), and the correction reason (None when open)."""
    found = service.find_visit(db, actor, event_id, occurrence_date)
    visit = service.lock_visit(db, found.visit.id) if found.visit is not None else None
    return visit, _may_write(db, actor, visit, reason, now)


def _room(db: Session, visit: Visit, room_id: int) -> PropertyRoom:
    room = db.get(PropertyRoom, room_id)
    if room is None or visit.property_id is None or room.property_id != visit.property_id:
        raise ApiError(422, "invalid_room")
    return room


def _room_name(db: Session, visit: Visit, room_id: int | None, other_name: str | None) -> str:
    if room_id is not None:
        return _room(db, visit, room_id).name
    name = (other_name or "").strip()
    if not 1 <= len(name) <= ROOM_NAME_MAX:
        raise ApiError(422, "invalid_room")
    return name


def precheck(db: Session, actor: User, event_id: int, occurrence_date: date, room_id: int | None, other_name: str | None, reason: str | None, now: datetime) -> None:
    """The early filter, before the body is read or decoded: no lock, the same conditions `add` re-checks under the lock."""
    found = service.find_visit(db, actor, event_id, occurrence_date)
    _may_write(db, actor, found.visit, reason, now)
    _room_name(db, found.visit, room_id, other_name)


def add(db: Session, settings: Settings, actor: User, event_id: int, occurrence_date: date, data: bytes, content_type: str, room_id: int | None, other_name: str | None, now: datetime, ip: str, reason: str | None = None) -> dict:
    """`content_type` comes from `validate(data)`, which the caller ran (before this takes the visit lock). `reason`: the
    correction reason, needed once the visit is closed."""
    visit, correction = _writable_visit(db, actor, event_id, occurrence_date, reason, now)
    ensure_space(settings)
    name = _room_name(db, visit, room_id, other_name)
    root = root_of(settings)
    file_id = storage.save(root, data)
    try:
        photo = VisitPhoto(
            visit_id=visit.id, file_id=file_id, room_id=room_id, room_name=name, content_type=content_type,
            size=len(data), sha256=hashlib.sha256(data).hexdigest(), uploaded_by=actor.id, uploaded_at=now,
        )
        db.add(photo)
        db.flush()
        audit.log(db, "visit_photo_added", actor_user_id=actor.id, ip=ip, details={"visit_id": visit.id, "room": name})
        if correction is not None:
            corrections.record(db, actor, visit, "add_photo", correction, {"photo_id": photo.id, "room": name}, now, ip)
        payload = service.visit_payload_of(db, actor, event_id, occurrence_date)
        db.commit()
    except BaseException:
        db.rollback()
        storage.delete(root, file_id)
        raise
    return payload


def _photo_row(db: Session, photo_id: int, removed_ok: bool = False) -> VisitPhoto:
    photo = db.get(VisitPhoto, photo_id)
    if photo is None or photo.purged_at is not None or (photo.deleted_at is not None and not removed_ok):
        raise ApiError(404, "not_found")
    return photo


def visible_photo(db: Session, actor: User, photo_id: int, removed_ok: bool = False) -> VisitPhoto:
    """The photo, or `404 not_found` when it is unknown, purged, removed (unless `removed_ok`) or on a visit the actor
    may not see."""
    photo = _photo_row(db, photo_id, removed_ok)
    visit = db.get(Visit, photo.visit_id)
    service.find_visit(db, actor, visit.event_id, visit.occurrence_date)  # raises the same 404 for a hidden visit
    return photo


def read(db: Session, settings: Settings, actor: User, photo_id: int) -> tuple[VisitPhoto, bytes]:
    """A removed photo whose file is still there (removed by a correction) opens for admins only; a plain removal
    deleted the file, so it answers 404 to them too."""
    photo = visible_photo(db, actor, photo_id, removed_ok=policy.can_open_removed_visit_photo(actor))
    try:
        return photo, storage.open_bytes(root_of(settings), photo.file_id)
    except (FileNotFoundError, ValueError):
        raise ApiError(404, "not_found")


def remove(db: Session, settings: Settings, actor: User, photo_id: int, now: datetime, ip: str, reason: str | None = None) -> dict:
    """While the visit is open on its day, only who uploaded the photo removes it, and its file is deleted. Once closed,
    or after the visit's day, it is a correction (`_correction`): Staff still remove only their own photos, admins any
    photo, and the file stays until the purge (ruling R16)."""
    photo = visible_photo(db, actor, photo_id)
    visit = db.get(Visit, photo.visit_id)
    event_id, occurrence_date = visit.event_id, visit.occurrence_date
    visit = service.lock_visit(db, visit.id)
    photo = db.scalars(select(VisitPhoto).where(VisitPhoto.id == photo_id).with_for_update().execution_options(populate_existing=True)).one()
    if photo.deleted_at is not None or photo.purged_at is not None:
        raise ApiError(404, "not_found")
    correction = _correction(db, actor, visit, reason, now)
    if photo.uploaded_by != actor.id and not (correction is not None and policy.can_correct_any_visit(actor)):
        raise ApiError(403, "forbidden")
    photo.deleted_at = now
    photo.deleted_by = actor.id
    db.flush()
    audit.log(db, "visit_photo_removed", actor_user_id=actor.id, ip=ip, details={"visit_id": visit.id, "room": photo.room_name})
    if correction is not None:
        corrections.record(db, actor, visit, "remove_photo", correction, {"photo_id": photo.id, "room": photo.room_name}, now, ip)
    payload = service.visit_payload_of(db, actor, event_id, occurrence_date)
    file_id = photo.file_id
    db.commit()
    if correction is None:  # a correction keeps the original until the 6-month purge
        try:
            storage.delete(root_of(settings), file_id)
        except OSError:
            pass  # the row already says removed; the purge deletes the file with the visit's other photos
    return payload


def skip(db: Session, actor: User, event_id: int, occurrence_date: date, room_id: int, reason: str, now: datetime, ip: str, correction_reason: str | None = None) -> dict:
    """`reason`: why the room has no photo. `correction_reason`: why it is done after the close (needed then)."""
    visit, correction = _writable_visit(db, actor, event_id, occurrence_date, correction_reason, now)
    reason = reason.strip()
    if not 1 <= len(reason) <= REASON_MAX:
        raise ApiError(422, "invalid_reason")
    room = _room(db, visit, room_id)
    if db.scalar(select(VisitRoomSkip.id).where(VisitRoomSkip.visit_id == visit.id, VisitRoomSkip.room_id == room.id)) is not None:
        raise ApiError(409, "already_skipped")
    db.add(VisitRoomSkip(visit_id=visit.id, room_id=room.id, room_name=room.name, reason=reason, skipped_by=actor.id, skipped_at=now))
    db.flush()
    audit.log(db, "visit_room_skipped", actor_user_id=actor.id, ip=ip, details={"visit_id": visit.id, "room": room.name})
    if correction is not None:
        corrections.record(db, actor, visit, "skip_room", correction, {"room": room.name}, now, ip)
    payload = service.visit_payload_of(db, actor, event_id, occurrence_date)
    db.commit()
    return payload
