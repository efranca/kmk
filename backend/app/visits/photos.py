"""Photos of a visit and room skips (the routes call these). While a visit is open, anyone checked in adds photos and skips
rooms, and a photo is removed only by who uploaded it. After the close everything answers `409 already_closed` (corrections
come later). The bytes live on disk (`storage`); the row is the record.

Write order: file first, then the row (the file is deleted if the row cannot be saved). Delete order: the row is marked
removed first, then the file is deleted (a leftover file is found by the cleanup, a row without a file never happens).
"""

import hashlib
import io
from datetime import date, datetime
from pathlib import Path

from PIL import Image
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import audit
from app.auth.errors import ApiError
from app.config import Settings
from app.documents.uploads import Slots
from app.models import PropertyRoom, User, Visit, VisitPhoto, VisitRoomSkip
from app.visits import service, storage
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


def _open_visit(db: Session, actor: User, event_id: int, occurrence_date: date) -> Visit:
    """The locked, open visit that the actor is checked in on (404 when they cannot see it)."""
    found = service.find_visit(db, actor, event_id, occurrence_date)
    if found.visit is None:
        raise ApiError(403, "not_checked_in")
    visit = service.lock_visit(db, found.visit.id)
    if visit.closed_at is not None:
        raise ApiError(409, "already_closed")
    if actor.id not in service._active_ids(db, visit.id):
        raise ApiError(403, "not_checked_in")
    return visit


def _room(db: Session, visit: Visit, room_id: int) -> PropertyRoom:
    room = db.get(PropertyRoom, room_id)
    if room is None or visit.property_id is None or room.property_id != visit.property_id:
        raise ApiError(422, "invalid_room")
    return room


def add(db: Session, settings: Settings, actor: User, event_id: int, occurrence_date: date, data: bytes, room_id: int | None, other_name: str | None, now: datetime, ip: str) -> dict:
    content_type = validate(data)  # decoding happens before the visit row is locked
    visit = _open_visit(db, actor, event_id, occurrence_date)
    ensure_space(settings)
    if room_id is not None:
        name = _room(db, visit, room_id).name
    else:
        name = (other_name or "").strip()
        if not 1 <= len(name) <= ROOM_NAME_MAX:
            raise ApiError(422, "invalid_room")
    root = root_of(settings)
    file_id = storage.save(root, data)
    try:
        db.add(
            VisitPhoto(
                visit_id=visit.id, file_id=file_id, room_id=room_id, room_name=name, content_type=content_type,
                size=len(data), sha256=hashlib.sha256(data).hexdigest(), uploaded_by=actor.id, uploaded_at=now,
            )
        )
        db.flush()
        audit.log(db, "visit_photo_added", actor_user_id=actor.id, ip=ip, details={"visit_id": visit.id, "room": name})
        payload = service.visit_payload_of(db, actor, event_id, occurrence_date)
        db.commit()
    except BaseException:
        db.rollback()
        storage.delete(root, file_id)
        raise
    return payload


def _photo_row(db: Session, photo_id: int) -> VisitPhoto:
    photo = db.get(VisitPhoto, photo_id)
    if photo is None or photo.deleted_at is not None or photo.purged_at is not None:
        raise ApiError(404, "not_found")
    return photo


def visible_photo(db: Session, actor: User, photo_id: int) -> VisitPhoto:
    """The photo, or `404 not_found` when it is unknown, removed, purged or on a visit the actor may not see."""
    photo = _photo_row(db, photo_id)
    visit = db.get(Visit, photo.visit_id)
    service.find_visit(db, actor, visit.event_id, visit.occurrence_date)  # raises the same 404 for a hidden visit
    return photo


def read(db: Session, settings: Settings, actor: User, photo_id: int) -> tuple[VisitPhoto, bytes]:
    photo = visible_photo(db, actor, photo_id)
    try:
        return photo, storage.open_bytes(root_of(settings), photo.file_id)
    except (FileNotFoundError, ValueError):
        raise ApiError(404, "not_found")


def remove(db: Session, settings: Settings, actor: User, photo_id: int, now: datetime, ip: str) -> dict:
    photo = visible_photo(db, actor, photo_id)
    visit = db.get(Visit, photo.visit_id)
    event_id, occurrence_date = visit.event_id, visit.occurrence_date
    visit = service.lock_visit(db, visit.id)
    photo = db.scalars(select(VisitPhoto).where(VisitPhoto.id == photo_id).with_for_update().execution_options(populate_existing=True)).one()
    if photo.deleted_at is not None or photo.purged_at is not None:
        raise ApiError(404, "not_found")
    if photo.uploaded_by != actor.id:
        raise ApiError(403, "forbidden")
    if visit.closed_at is not None:
        raise ApiError(409, "already_closed")
    photo.deleted_at = now
    photo.deleted_by = actor.id
    db.flush()
    audit.log(db, "visit_photo_removed", actor_user_id=actor.id, ip=ip, details={"visit_id": visit.id, "room": photo.room_name})
    payload = service.visit_payload_of(db, actor, event_id, occurrence_date)
    file_id = photo.file_id
    db.commit()
    try:
        storage.delete(root_of(settings), file_id)
    except OSError:
        pass  # the row already says removed; the cleanup finds a file that is left
    return payload


def skip(db: Session, actor: User, event_id: int, occurrence_date: date, room_id: int, reason: str, now: datetime, ip: str) -> dict:
    visit = _open_visit(db, actor, event_id, occurrence_date)
    reason = reason.strip()
    if not 1 <= len(reason) <= REASON_MAX:
        raise ApiError(422, "invalid_reason")
    room = _room(db, visit, room_id)
    if db.scalar(select(VisitRoomSkip.id).where(VisitRoomSkip.visit_id == visit.id, VisitRoomSkip.room_id == room.id)) is not None:
        raise ApiError(409, "already_skipped")
    db.add(VisitRoomSkip(visit_id=visit.id, room_id=room.id, room_name=room.name, reason=reason, skipped_by=actor.id, skipped_at=now))
    db.flush()
    audit.log(db, "visit_room_skipped", actor_user_id=actor.id, ip=ip, details={"visit_id": visit.id, "room": room.name})
    payload = service.visit_payload_of(db, actor, event_id, occurrence_date)
    db.commit()
    return payload
