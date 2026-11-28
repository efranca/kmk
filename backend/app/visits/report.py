"""The "Visits done" report (spec section 11): how many visits each person did, so the owner can pay them.

A person counts once for a visit when they have an active check-in (`withdrawn_at IS NULL`) on a CLOSED visit whose
`visit_date` is in the range. Everything is read from the `visits` table and its own copies of the names (the Agenda item,
client or property may be gone). Times are company time `HH:MM`, proof only: never summed, never "hours". The queries are
set-based: a fixed number for the whole range, whatever the number of visits.
"""

import csv
import io
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import User, Visit, VisitCorrection, VisitPerson, VisitPhoto
from app.schedule.service import COMPANY_TZ, display_name

CSV_HEADER = ["date", "person", "client", "property", "check_in", "check_out", "photos", "closed_without_photos", "corrected", "checked_in_by"]
_FORMULA_START = ("=", "+", "-", "@")


def _hhmm(moment: datetime | None) -> str | None:
    return moment.astimezone(COMPANY_TZ).strftime("%H:%M") if moment is not None else None


def _key(person: VisitPerson) -> object:
    """Who a check-in counts for: the account, or, once the account was deleted (`user_id` NULL), its name copy. Two
    deleted accounts with the same name are therefore merged into one summary line (and one visit counts once for
    them): nothing else tells them apart any more. The CSV still lists every visit and person."""
    return person.user_id if person.user_id is not None else ("name", person.user_name)


def _done(db: Session, frm: date, to: date) -> list[tuple[Visit, VisitPerson]]:
    """One row per person per closed visit in range (active check-ins only), oldest visit first."""
    stmt = (
        select(Visit, VisitPerson)
        .join(VisitPerson, VisitPerson.visit_id == Visit.id)
        .where(Visit.closed_at.is_not(None), Visit.visit_date >= frm, Visit.visit_date <= to, VisitPerson.withdrawn_at.is_(None))
        .order_by(Visit.visit_date, Visit.id, VisitPerson.checked_in_at, VisitPerson.id)
    )
    seen: set[tuple[int, object]] = set()
    out = []
    for visit, person in db.execute(stmt):
        if (visit.id, _key(person)) in seen:  # never count a person twice on one visit
            continue
        seen.add((visit.id, _key(person)))
        out.append((visit, person))
    return out


def _facts(db: Session, visit_ids: set[int]) -> tuple[dict[int, int], set[int]]:
    """Photos still there per visit, and the visits carrying at least one correction (two queries for all)."""
    if not visit_ids:
        return {}, set()
    photos: dict[int, int] = {}
    live = select(VisitPhoto.visit_id).where(VisitPhoto.visit_id.in_(visit_ids), VisitPhoto.deleted_at.is_(None), VisitPhoto.purged_at.is_(None))
    for visit_id in db.scalars(live):
        photos[visit_id] = photos.get(visit_id, 0) + 1
    corrected = set(db.scalars(select(VisitCorrection.visit_id).where(VisitCorrection.visit_id.in_(visit_ids)).distinct()))
    return photos, corrected


def _user_names(db: Session, ids: set[int]) -> dict[int, str]:
    return {u.id: display_name(u) for u in db.scalars(select(User).where(User.id.in_(ids)))} if ids else {}


def _line(visit: Visit, person: VisitPerson, photos: dict[int, int], corrected: set[int], by_names: dict[int, str]) -> dict:
    by = person.checked_in_by
    return {
        "event_id": visit.event_id,
        "occurrence_date": visit.occurrence_date.isoformat(),
        "date": visit.visit_date.isoformat(),
        "client_name": visit.client_name,
        "property_name": visit.property_name,
        "checked_in_at": _hhmm(person.checked_in_at),
        "closed_at": _hhmm(visit.closed_at),
        "photos": photos.get(visit.id, 0),
        "without_photos": bool(visit.closed_without_photos),
        "corrected": visit.id in corrected,
        "checked_in_by_name": by_names.get(by) if by is not None else None,
        # who recorded the check-in, by ids (as the visit payload does): names can change or be shared; an account or
        # checker that no longer exists (NULL) is never "self"
        "self": by is not None and person.user_id is not None and by == person.user_id,
    }


def summary(db: Session, frm: date, to: date) -> dict:
    rows = _done(db, frm, to)
    _, corrected = _facts(db, {v.id for v, _ in rows})
    people: dict[object, dict] = {}
    latest: dict[object, datetime] = {}
    for visit, person in rows:
        key = _key(person)
        entry = people.setdefault(key, {"user_id": person.user_id, "name": person.user_name, "visits": 0, "corrected": 0, "without_photos": 0})
        entry["visits"] += 1
        entry["corrected"] += visit.id in corrected
        entry["without_photos"] += bool(visit.closed_without_photos)
        if key not in latest or person.checked_in_at > latest[key]:  # the name copy of the most recent check-in
            latest[key] = person.checked_in_at
            entry["name"] = person.user_name
    ordered = sorted(people.values(), key=lambda p: (p["name"].casefold(), p["user_id"] or 0))
    return {"people": ordered, "open": _open(db, frm, to)}


def _open(db: Session, frm: date, to: date) -> list[dict]:
    """Visits in range with at least one active check-in and no close."""
    stmt = (
        select(Visit, VisitPerson.user_name)
        .join(VisitPerson, VisitPerson.visit_id == Visit.id)
        .where(Visit.closed_at.is_(None), Visit.visit_date >= frm, Visit.visit_date <= to, VisitPerson.withdrawn_at.is_(None))
        .order_by(Visit.visit_date, Visit.id, VisitPerson.checked_in_at, VisitPerson.id)
    )
    found: dict[int, dict] = {}
    for visit, name in db.execute(stmt):
        item = found.setdefault(
            visit.id,
            {"event_id": visit.event_id, "occurrence_date": visit.occurrence_date.isoformat(), "date": visit.visit_date.isoformat(), "client_name": visit.client_name, "property_name": visit.property_name, "people": []},
        )
        if name not in item["people"]:
            item["people"].append(name)
    return list(found.values())


def person(db: Session, user_id: int, frm: date, to: date) -> list[dict]:
    rows = [(v, p) for v, p in _done(db, frm, to) if p.user_id == user_id]
    photos, corrected = _facts(db, {v.id for v, _ in rows})
    by_names = _user_names(db, {p.checked_in_by for _, p in rows if p.checked_in_by is not None})
    return [_line(v, p, photos, corrected, by_names) for v, p in rows]


def safe_cell(value: object) -> str:
    """A cell as text; one a spreadsheet could take for a formula (after any leading whitespace, Unicode included: a
    no-break space, a vertical tab...) gets a leading `'`."""
    text = "" if value is None else str(value)
    if text.lstrip().startswith(_FORMULA_START):
        return "'" + text
    return text


def csv_text(db: Session, frm: date, to: date) -> str:
    rows = _done(db, frm, to)
    photos, corrected = _facts(db, {v.id for v, _ in rows})
    by_names = _user_names(db, {p.checked_in_by for _, p in rows if p.checked_in_by is not None})
    out = io.StringIO(newline="")
    writer = csv.writer(out, quoting=csv.QUOTE_ALL, lineterminator="\r\n")
    writer.writerow(CSV_HEADER)
    for visit, who in sorted(rows, key=lambda r: (r[0].visit_date, r[1].user_name.casefold(), r[0].id)):
        line = _line(visit, who, photos, corrected, by_names)
        cells = (
            line["date"],
            who.user_name,
            line["client_name"],
            line["property_name"],
            line["checked_in_at"],
            line["closed_at"],
            line["photos"],
            "yes" if line["without_photos"] else "no",
            "yes" if line["corrected"] else "no",
            line["checked_in_by_name"],
        )
        writer.writerow([safe_cell(x) for x in cells])
    return out.getvalue()
