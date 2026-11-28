"""Visits: check-in and check-out of one occurrence of an Agenda item that has a property (the routes call these, then commit).

A visit is identified like an invoice line, by `(event_id, occurrence_date)` where `occurrence_date` is the series' original
date. Its `visits` row is created by the first check-in and keeps copies of the date and of the client and property names,
so the record outlives changes to the Agenda. Who sees a visit comes from `policy.can_see_visit`; a visit someone may not
see answers `404 not_found`, exactly like one that does not exist. The server's clock (`now()`) is the only clock.
"""

from dataclasses import dataclass
from datetime import date, datetime, time, timezone

from sqlalchemy import or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app import names
from app.auth import audit, policy
from app.auth.errors import ApiError
from app.clients.service import rooms_by_property
from app.invoices.billing import occurrence_of
from app.models import Client, Event, EventException, EventPerson, Property, PropertyRoom, User, Visit, VisitCorrection, VisitPerson, VisitPhoto, VisitRoomSkip
from app.schedule.occurrences import Occurrence, expand
from app.schedule.service import COMPANY_TZ, display_name, event_data, exception_data


def now() -> datetime:
    """The only clock of the module (timezone-aware UTC); tests patch it."""
    return datetime.now(timezone.utc)


def company_date(moment: datetime) -> date:
    return moment.astimezone(COMPANY_TZ).date()


def _iso(value: datetime | None) -> str | None:
    return value.astimezone(timezone.utc).isoformat() if value is not None else None


@dataclass
class Found:
    """What one `(event_id, occurrence_date)` key points to, for someone allowed to see it."""

    event: Event
    occurrence_date: date
    occurrence: Occurrence | None  # None when the occurrence was cancelled or moved out of the series after a check-in
    visit: Visit | None  # None until the first check-in
    listed: frozenset[int]  # the people the Agenda item lists now


def _rows(db: Session, visit_id: int) -> list[VisitPerson]:
    return list(db.scalars(select(VisitPerson).where(VisitPerson.visit_id == visit_id).order_by(VisitPerson.checked_in_at, VisitPerson.id)))


def _active_ids(db: Session, visit_id: int) -> set[int]:
    return set(db.scalars(select(VisitPerson.user_id).where(VisitPerson.visit_id == visit_id, VisitPerson.withdrawn_at.is_(None), VisitPerson.user_id.is_not(None))))


def find_visit(db: Session, actor: User, event_id: int, occurrence_date: date) -> Found:
    """The visit at this key, or `404 not_found` when there is no such event, the occurrence does not exist, is cancelled
    or has no property (and was never started), or this person may not see it. Visibility is decided before anything
    about the occurrence is computed, so a hidden visit answers exactly like a missing one."""
    event = db.get(Event, event_id)
    if event is None:
        raise ApiError(404, "not_found")
    visit = db.scalar(select(Visit).where(Visit.event_id == event_id, Visit.occurrence_date == occurrence_date))
    listed = frozenset(db.scalars(select(EventPerson.user_id).where(EventPerson.event_id == event_id)))
    # Anyone with a check-in row (even a withdrawn one) keeps seeing the record of what they did.
    checked_in = frozenset(db.scalars(select(VisitPerson.user_id).where(VisitPerson.visit_id == visit.id, VisitPerson.user_id.is_not(None)))) if visit else frozenset()
    if not policy.can_see_visit(actor, listed, checked_in):
        raise ApiError(404, "not_found")
    occurrence = occurrence_of(db, event, occurrence_date)
    if visit is None and (occurrence is None or event.property_id is None):
        raise ApiError(404, "not_found")
    return Found(event, occurrence_date, occurrence, visit, listed)


def lock_visit(db: Session, visit_id: int) -> Visit:
    """The visit row, locked until the transaction ends (`SELECT ... FOR UPDATE`), read fresh from the database."""
    return db.scalars(select(Visit).where(Visit.id == visit_id).with_for_update().execution_options(populate_existing=True)).one()


def _start(db: Session, found: Found) -> Visit:
    """The visit row of this occurrence, created if needed, locked. Two first check-ins at the same moment: the second
    INSERT does nothing (it waits for the first one's transaction), then both lock the same row in turn."""
    if found.visit is None:
        prop = db.get(Property, found.event.property_id)
        client = db.get(Client, prop.client_id)
        db.execute(
            insert(Visit)
            .values(
                event_id=found.event.id,
                occurrence_date=found.occurrence_date,
                visit_date=found.occurrence.date,
                client_id=client.id,
                property_id=prop.id,
                client_name=client.name,
                property_name=prop.name,
            )
            .on_conflict_do_nothing(index_elements=["event_id", "occurrence_date"])
        )
        visit_id = db.scalar(select(Visit.id).where(Visit.event_id == found.event.id, Visit.occurrence_date == found.occurrence_date))
    else:
        visit_id = found.visit.id
    return lock_visit(db, visit_id)


# ---- payloads ---------------------------------------------------------------------------------------------------


def _names(db: Session, ids: set[int]) -> dict[int, User]:
    return {u.id: u for u in db.scalars(select(User).where(User.id.in_(ids)))} if ids else {}


def _photos_and_skips(db: Session, visit: Visit) -> tuple[list[dict], int, list[dict]]:
    """The photos still there (removed and purged ones are left out), how many were ever taken, and the room skips."""
    all_photos = list(db.scalars(select(VisitPhoto).where(VisitPhoto.visit_id == visit.id).order_by(VisitPhoto.uploaded_at, VisitPhoto.id)))
    skip_rows = list(db.scalars(select(VisitRoomSkip).where(VisitRoomSkip.visit_id == visit.id).order_by(VisitRoomSkip.skipped_at, VisitRoomSkip.id)))
    users = _names(db, {p.uploaded_by for p in all_photos if p.uploaded_by is not None} | {k.skipped_by for k in skip_rows if k.skipped_by is not None})
    name_of = lambda user_id: display_name(users[user_id]) if user_id in users else None  # noqa: E731
    photos = [
        {"id": p.id, "room_id": p.room_id, "room_name": p.room_name, "uploaded_by_name": name_of(p.uploaded_by), "uploaded_at": _iso(p.uploaded_at), "url": f"/api/visit-photos/{p.id}"}
        for p in all_photos
        if p.deleted_at is None and p.purged_at is None
    ]
    skips = [{"id": k.id, "room_id": k.room_id, "room_name": k.room_name, "reason": k.reason, "skipped_by_name": name_of(k.skipped_by), "skipped_at": _iso(k.skipped_at)} for k in skip_rows]
    return photos, len(all_photos), skips


def _corrections(db: Session, visit: Visit) -> list[dict]:
    """The corrections of a visit, newest first; `actor_name` is the copy taken when the correction was made."""
    out = []
    for c in db.scalars(select(VisitCorrection).where(VisitCorrection.visit_id == visit.id).order_by(VisitCorrection.created_at.desc(), VisitCorrection.id.desc())):
        details = dict(c.details or {})
        actor_name = details.pop("actor_name", None)
        out.append({"kind": c.kind, "actor_name": actor_name, "reason": c.reason, "created_at": _iso(c.created_at), "details": details})
    return out


def _correct_until(actor: User, all_rows: list[VisitPerson], listed: frozenset[int], day: date) -> str | None:
    """Until when this person may correct the visit: `None` for admins (never limited) and for someone who may not
    correct it at all; else the end of the window, for whoever was checked in (even withdrawn) and, on a visit never
    started, for a listed person (a late check-in of themselves)."""
    from app.visits.corrections import window_end  # corrections imports this module

    if policy.can_correct_any_visit(actor):
        return None
    if actor.id in {r.user_id for r in all_rows} or (not all_rows and actor.id in listed):
        return _iso(window_end(day))
    return None


def visit_payload(db: Session, actor: User, event: Event | None, occurrence: Occurrence | None, visit: Visit | None, listed: frozenset[int], occurrence_date: date) -> dict:
    """One visit as the pages show it. Before the first check-in it is the occurrence with `"id": None`."""
    property_id = visit.property_id if visit is not None else event.property_id
    prop = db.get(Property, property_id) if property_id is not None else None
    if visit is not None:
        client_name, property_name, day = visit.client_name, visit.property_name, visit.visit_date
    else:
        client = db.get(Client, prop.client_id) if prop is not None else None
        client_name, property_name, day = (client.name if client else None), (prop.name if prop else None), occurrence.date
    title = occurrence.title if occurrence is not None else event.title if event is not None else property_name

    all_rows = _rows(db, visit.id) if visit is not None else []
    rows = [r for r in all_rows if r.withdrawn_at is None]  # only active people are shown (withdrawn rows stay as proof)
    users = _names(db, set(listed) | {r.checked_in_by for r in rows if r.checked_in_by is not None} | ({visit.closed_by} if visit is not None and visit.closed_by else set()))
    name_of = lambda user_id: display_name(users[user_id]) if user_id in users else None  # noqa: E731
    listed_users = sorted((users[i] for i in listed if i in users), key=lambda u: names.sort_key(u.name, u.username))

    photos, photo_total, skips = _photos_and_skips(db, visit) if visit is not None else ([], 0, [])
    state = "not_started" if visit is None else "closed" if visit.closed_at is not None else "in_progress"
    corrections = _corrections(db, visit) if visit is not None else []
    return {
        "id": visit.id if visit is not None else None,
        "event_id": visit.event_id if visit is not None else event.id,
        "occurrence_date": occurrence_date.isoformat(),
        "date": day.isoformat(),
        "title": title,
        "client_name": client_name,
        "property_name": property_name,
        "property_id": prop.id if prop is not None else None,
        "photos_required": bool(prop.photos_required) if prop is not None else False,
        "rooms": rooms_by_property(db, [prop.id]).get(prop.id, []) if prop is not None else [],
        "state": state,
        "people": [
            {
                "user_id": r.user_id,
                "name": r.user_name,
                "checked_in_at": _iso(r.checked_in_at),
                "checked_in_by_name": name_of(r.checked_in_by),
                "self": r.checked_in_by is not None and r.checked_in_by == r.user_id,
            }
            for r in rows
        ],
        "listed": [{"user_id": u.id, "name": display_name(u)} for u in listed_users],
        "closed_at": _iso(visit.closed_at) if visit is not None else None,
        "closed_by_name": name_of(visit.closed_by) if visit is not None and visit.closed_by is not None else None,
        "closed_without_photos": bool(visit.closed_without_photos) if visit is not None else False,
        "corrected": bool(corrections),
        "photos": photos,
        "photo_count_total": photo_total,
        "skips": skips,
        "corrections": corrections,
        "can_correct_until": _correct_until(actor, all_rows, listed, day),
    }


def _found_payload(db: Session, actor: User, found: Found, visit: Visit | None = None) -> dict:
    return visit_payload(db, actor, found.event, found.occurrence, visit if visit is not None else found.visit, found.listed, found.occurrence_date)


def visit_payload_of(db: Session, actor: User, event_id: int, occurrence_date: date) -> dict:
    """The visit as the pages show it now (after a change in the same transaction)."""
    return _found_payload(db, actor, find_visit(db, actor, event_id, occurrence_date))


# ---- reading ----------------------------------------------------------------------------------------------------


def today(db: Session, actor: User, now: datetime) -> list[dict]:
    """The visits of today (company date) that list this person, by start time (all-day first)."""
    day = company_date(now)
    moved_here = select(EventException.event_id).where(EventException.start_date == day, EventException.cancelled.is_(False))
    events = db.scalars(
        select(Event)
        .join(EventPerson, EventPerson.event_id == Event.id)
        .where(
            EventPerson.user_id == actor.id,
            Event.property_id.is_not(None),
            Event.start_date <= day,
            or_(Event.recurrence.is_not(None), Event.start_date == day, Event.id.in_(moved_here)),
        )
    ).all()
    if not events:
        return []
    ids = [e.id for e in events]
    exceptions: dict[int, list] = {i: [] for i in ids}
    for x in db.scalars(select(EventException).where(EventException.event_id.in_(ids))):
        exceptions[x.event_id].append(exception_data(x))
    found = [(o, e) for e in events for o in expand(event_data(e), exceptions[e.id], day, day)]
    found.sort(key=lambda pair: (pair[0].start_time is not None, pair[0].start_time or time.min, pair[1].id))
    visits = {(v.event_id, v.occurrence_date): v for v in db.scalars(select(Visit).where(Visit.event_id.in_(ids), Visit.occurrence_date.in_({o.original_date for o, _ in found})))}
    listed: dict[int, set[int]] = {i: set() for i in ids}
    for event_id, user_id in db.execute(select(EventPerson.event_id, EventPerson.user_id).where(EventPerson.event_id.in_(ids))):
        listed[event_id].add(user_id)
    return [visit_payload(db, actor, e, o, visits.get((e.id, o.original_date)), frozenset(listed[e.id]), o.original_date) for o, e in found]


def get_visit(db: Session, actor: User, event_id: int, occurrence_date: date) -> dict:
    return _found_payload(db, actor, find_visit(db, actor, event_id, occurrence_date))


# ---- check-in and check-out -------------------------------------------------------------------------------------


def check_in(db: Session, actor: User, event_id: int, occurrence_date: date, people: list[int], now: datetime, ip: str) -> dict:
    """The actor checks in themselves and/or the colleagues with them. Everyone must be listed on the Agenda item now; the
    actor must be among `people` or already checked in; only on the visit's actual date (company time zone)."""
    found = find_visit(db, actor, event_id, occurrence_date)
    wanted = list(dict.fromkeys(people))
    if actor.id not in found.listed or any(p not in found.listed for p in wanted):
        raise ApiError(403, "not_listed")
    day = found.visit.visit_date if found.visit is not None else found.occurrence.date
    if company_date(now) != day:
        raise ApiError(422, "not_today")
    visit = _start(db, found)
    if visit.closed_at is not None:
        raise ApiError(409, "already_closed")
    active = _active_ids(db, visit.id)
    if actor.id not in wanted and actor.id not in active:
        raise ApiError(403, "not_checked_in")
    if any(p in active for p in wanted):
        raise ApiError(409, "already_checked_in")
    users = _names(db, set(wanted))
    for person in wanted:
        db.add(VisitPerson(visit_id=visit.id, user_id=person, user_name=display_name(users[person]), checked_in_at=now, checked_in_by=actor.id))
    db.flush()
    audit.log(db, "visit_checkin", actor_user_id=actor.id, ip=ip, details={"visit_id": visit.id, "people": wanted})
    return _found_payload(db, actor, found, visit)


def missing_rooms(db: Session, visit: Visit) -> list[str]:
    """For a property with "photos required": the rooms on its list with neither an active photo nor a skip, in order."""
    prop = db.get(Property, visit.property_id) if visit.property_id is not None else None
    if prop is None or not prop.photos_required:
        return []
    covered = set(db.scalars(select(VisitPhoto.room_id).where(VisitPhoto.visit_id == visit.id, VisitPhoto.deleted_at.is_(None), VisitPhoto.purged_at.is_(None), VisitPhoto.room_id.is_not(None))))
    covered |= set(db.scalars(select(VisitRoomSkip.room_id).where(VisitRoomSkip.visit_id == visit.id, VisitRoomSkip.room_id.is_not(None))))
    rooms = db.scalars(select(PropertyRoom).where(PropertyRoom.property_id == prop.id).order_by(PropertyRoom.position))
    return [r.name for r in rooms if r.id not in covered]


def has_photos(db: Session, visit_id: int) -> bool:
    return db.scalar(select(VisitPhoto.id).where(VisitPhoto.visit_id == visit_id, VisitPhoto.deleted_at.is_(None), VisitPhoto.purged_at.is_(None)).limit(1)) is not None


def check_out(db: Session, actor: User, event_id: int, occurrence_date: date, confirm_no_photos: bool, now: datetime, ip: str) -> dict:
    """Any person checked in closes the visit, for everyone checked in, on the visit's own day (company time zone)."""
    found = find_visit(db, actor, event_id, occurrence_date)
    if found.visit is None:
        raise ApiError(403, "not_checked_in")
    visit = lock_visit(db, found.visit.id)
    if actor.id not in _active_ids(db, visit.id):
        raise ApiError(403, "not_checked_in")
    if visit.closed_at is not None:
        raise ApiError(409, "already_closed")
    if company_date(now) > visit.visit_date:  # after the visit's day, a forgotten check-out is closed by a correction
        raise ApiError(422, "not_today")
    missing = missing_rooms(db, visit)
    if missing:
        raise ApiError(409, "rooms_missing", {"rooms": missing})
    photos = has_photos(db, visit.id)
    if not photos and not confirm_no_photos:
        raise ApiError(409, "no_photos")
    visit.closed_at = now
    visit.closed_by = actor.id
    visit.closed_without_photos = not photos
    db.flush()
    audit.log(db, "visit_checkout", actor_user_id=actor.id, ip=ip, details={"visit_id": visit.id, "without_photos": not photos})
    return _found_payload(db, actor, found, visit)
