"""Which cleanings can be billed: past, not cancelled, of this client, not already on a live invoice line."""

from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.invoices import money
from app.models import Event, EventException, InvoiceLine, Property
from app.schedule.occurrences import Occurrence, expand, own_dates
from app.schedule.service import COMPANY_TZ, event_data, exception_data

DESCRIPTION_MAX = 200


def company_today() -> date:
    return datetime.now(COMPANY_TZ).date()


def default_description(property_name: str | None, title: str, day: date) -> str:
    return f"Entretien ménager - {property_name or title} - {day:%d/%m/%Y}"[:DESCRIPTION_MAX]


def occurrence_of(db: Session, event: Event, original: date) -> Occurrence | None:
    """The one occurrence of this event whose original date is `original` (exceptions respected), or None when the series
    has no such date or that occurrence is cancelled."""
    data = event_data(event)
    if not own_dates(data, original, original):
        return None
    exceptions = [exception_data(x) for x in db.scalars(select(EventException).where(EventException.event_id == event.id))]
    changed = next((x for x in exceptions if x.original_date == original), None)
    if changed is not None and changed.cancelled:
        return None
    day = changed.start_date if changed is not None and changed.start_date is not None else original
    return next((o for o in expand(data, exceptions, day, day) if o.original_date == original), None)


def billable(db: Session, client_id: int, from_: date, to: date, today: date) -> list[dict]:
    """The client's occurrences with an actual date in `from_..to` (`to` clamped to `today`), oldest first."""
    to = min(to, today)
    if to < from_:
        return []
    events = db.scalars(select(Event).where(Event.client_id == client_id)).all()
    if not events:
        return []
    ids = [e.id for e in events]
    exceptions: dict[int, list] = {i: [] for i in ids}
    for x in db.scalars(select(EventException).where(EventException.event_id.in_(ids))):
        exceptions[x.event_id].append(exception_data(x))
    billed = set(db.execute(select(InvoiceLine.event_id, InvoiceLine.occurrence_date).where(InvoiceLine.live, InvoiceLine.event_id.in_(ids))).all())
    props = {p.id: p for p in db.scalars(select(Property).where(Property.client_id == client_id))}

    found: list[tuple[Occurrence, Event]] = []
    for event in events:
        for o in expand(event_data(event), exceptions[event.id], from_, to):
            if (event.id, o.original_date) not in billed:
                found.append((o, event))
    found.sort(key=lambda pair: (pair[0].date, pair[0].start_time is not None, pair[0].start_time or datetime.min.time(), pair[1].id))
    out = []
    for o, event in found:
        prop = props.get(event.property_id) if event.property_id is not None else None
        out.append(
            {
                "event_id": event.id,
                "occurrence_date": o.original_date.isoformat(),
                "date": o.date.isoformat(),
                "title": o.title,
                "property_id": prop.id if prop else None,
                "property_name": prop.name if prop else None,
                "price": money.as_json(prop.visit_price) if prop else None,
                "description": default_description(prop.name if prop else None, o.title, o.date),
            }
        )
    return out
