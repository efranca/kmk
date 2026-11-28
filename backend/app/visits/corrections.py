"""Corrections of a visit after the fact (spec section 10). The visit record is proof: nothing is erased. A withdrawn
check-in keeps its row (with `withdrawn_at/by`), a reopen keeps the close it undid in its details, and every correction
appends one `visit_corrections` row (who, when, what, why; the app role may only insert and read it) and one audit row.

Who corrects: admins and the super admin, any visit at any time; anyone else only on a visit they were checked in on
(active or withdrawn), until `window_end` of its date. One more case: a listed person adds themselves to a visit that was
never started (a forgotten check-in), which creates the visit. The visit row is locked for every correction and every
condition is checked under that lock, so a double submission or two people at once give one change and one `409`.
"""

from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy.orm import Session

from app.auth import audit, policy
from app.auth.errors import ApiError
from app.models import User, Visit, VisitCorrection, VisitPerson
from app.schedule.service import COMPANY_TZ, display_name
from app.visits import service
from app.visits.limits import REASON_MAX
from app.visits.schemas import CorrectionIn


def window_end(visit_date: date) -> datetime:
    """The first instant after the day following the visit, company time (midnight starting `visit_date + 2 days`)."""
    try:
        end = visit_date + timedelta(days=2)
    except OverflowError:  # the last days of the calendar (a far occurrence of an endless series): no end
        return datetime.max.replace(tzinfo=timezone.utc)
    return datetime.combine(end, time(0, 0), COMPANY_TZ)


def may_correct(actor: User, visit: Visit, checked_in_ids: frozenset[int], now: datetime) -> bool:
    return policy.can_correct_visit(actor, checked_in_ids, now < window_end(visit.visit_date))


def check(actor: User, visit: Visit, checked_in_ids: frozenset[int], now: datetime) -> None:
    """`may_correct`, or the reason why not: `403 not_checked_in` (never on this visit), `403 correction_window_closed`."""
    if may_correct(actor, visit, checked_in_ids, now):
        return
    if actor.id not in checked_in_ids:
        raise ApiError(403, "not_checked_in")
    raise ApiError(403, "correction_window_closed")


def clean_reason(reason: str) -> str:
    """The reason of a correction sent outside `CorrectionIn` (photo and skip requests): trimmed, 1..200 characters."""
    reason = reason.strip()
    if not 1 <= len(reason) <= REASON_MAX:
        raise ApiError(422, "invalid_reason")
    return reason


def record(db: Session, actor: User, visit: Visit, kind: str, reason: str, details: dict, now: datetime, ip: str) -> None:
    """Append the correction (with a copy of the actor's name, which outlives the account) and its audit row (visit id and
    kind only: the reason text never goes to the audit log)."""
    db.add(VisitCorrection(visit_id=visit.id, kind=kind, actor_id=actor.id, reason=reason, details={"actor_name": display_name(actor), **details}, created_at=now))
    db.flush()
    audit.log(db, "visit_corrected", actor_user_id=actor.id, ip=ip, details={"visit_id": visit.id, "kind": kind})


def checked_in_ids(db: Session, visit_id: int) -> frozenset[int]:
    """Everyone with a check-in row on the visit, withdrawn ones included."""
    return frozenset(r.user_id for r in service._rows(db, visit_id) if r.user_id is not None)


# ---- the kinds sent to POST .../corrections ---------------------------------------------------------------------


def _close(db: Session, actor: User, visit: Visit, active: dict[int, VisitPerson], data: CorrectionIn, found: service.Found, now: datetime) -> dict:
    """A visit left open: the same rules as the check-out, except that the reason stands for "close without photos"."""
    if visit.closed_at is not None:
        raise ApiError(409, "already_closed")
    if not active:
        raise ApiError(409, "not_checked_in")  # nobody to count the visit for
    missing = service.missing_rooms(db, visit)
    if missing:
        raise ApiError(409, "rooms_missing", {"rooms": missing})
    without = not service.has_photos(db, visit.id)
    visit.closed_at = now
    visit.closed_by = actor.id
    visit.closed_without_photos = without
    return {"without_photos": without}


def _withdraw(db: Session, actor: User, visit: Visit, active: dict[int, VisitPerson], data: CorrectionIn, found: service.Found, now: datetime) -> dict:
    """A check-in made by mistake: the row stays, marked withdrawn (and the person no longer counts for the visit)."""
    row = active.get(data.user_id)
    if row is None:
        raise ApiError(409, "not_checked_in")
    row.withdrawn_at = now
    row.withdrawn_by = actor.id
    return {"user_id": data.user_id, "user_name": row.user_name}


def _add_person(db: Session, actor: User, visit: Visit, active: dict[int, VisitPerson], data: CorrectionIn, found: service.Found, now: datetime) -> dict:
    """A late check-in of a listed person, once the visit is closed or its day is over (before that, the check-in does it).
    The time recorded is the time of the correction, and the actor is who recorded it."""
    if visit.closed_at is None and service.company_date(now) <= visit.visit_date:
        raise ApiError(409, "not_closed")
    if data.user_id not in found.listed:
        raise ApiError(403, "not_listed")
    if data.user_id in active:
        raise ApiError(409, "already_checked_in")
    name = display_name(service._names(db, {data.user_id})[data.user_id])
    db.add(VisitPerson(visit_id=visit.id, user_id=data.user_id, user_name=name, checked_in_at=now, checked_in_by=actor.id))
    return {"user_id": data.user_id, "user_name": name}


def _reopen(db: Session, actor: User, visit: Visit, active: dict[int, VisitPerson], data: CorrectionIn, found: service.Found, now: datetime) -> dict:
    """A visit closed by mistake (admins only): the close it undoes is kept in the correction's details."""
    if visit.closed_at is None:
        raise ApiError(409, "not_closed")
    closer = service._names(db, {visit.closed_by}).get(visit.closed_by) if visit.closed_by is not None else None
    details = {"closed_at": service._iso(visit.closed_at), "closed_by_name": display_name(closer) if closer else None, "closed_without_photos": bool(visit.closed_without_photos)}
    visit.closed_at = None
    visit.closed_by = None
    visit.closed_without_photos = False
    return details


KINDS = {"close": _close, "withdraw": _withdraw, "add_person": _add_person, "reopen": _reopen}


def apply(db: Session, actor: User, event_id: int, occurrence_date: date, data: CorrectionIn, now: datetime, ip: str) -> dict:
    """One correction (the route commits). Order: `404` (missing or hidden visit), `403 forbidden` (reopen by Staff),
    then under the visit's lock the authority (`403 not_checked_in` / `403 correction_window_closed`), then the state
    of the visit (`409`)."""
    found = service.find_visit(db, actor, event_id, occurrence_date)
    if data.kind == "reopen":
        policy.check_visit_admin(actor)
    if found.visit is None and data.kind != "add_person":
        if not policy.can_correct_any_visit(actor):
            raise ApiError(403, "not_checked_in")
        raise ApiError(409, "not_closed" if data.kind == "reopen" else "not_checked_in")
    # Creates the visit for a late check-in on a visit never started (insert-or-nothing, then lock), else locks it. On a
    # refusal below, the transaction is rolled back and nothing is created.
    visit = service._start(db, found)
    rows = service._rows(db, visit.id)
    ids = frozenset(r.user_id for r in rows if r.user_id is not None)
    late_self = data.kind == "add_person" and not rows and data.user_id == actor.id
    if late_self and not policy.can_correct_any_visit(actor):
        if now >= window_end(visit.visit_date):
            raise ApiError(403, "correction_window_closed")
    else:
        check(actor, visit, ids, now)
    active = {r.user_id: r for r in rows if r.withdrawn_at is None and r.user_id is not None}
    details = KINDS[data.kind](db, actor, visit, active, data, found, now)
    record(db, actor, visit, data.kind, data.reason, details, now, ip)
    return service._found_payload(db, actor, found, visit)
