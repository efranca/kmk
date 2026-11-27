"""Schedule use cases: list, create, change and delete events (the routes call these, then commit).

Authority comes from `app.auth.policy`; every change is audited with ids and field names, never notes text.
"""

import unicodedata
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session

from app import names
from app.clients.service import check_client, check_property
from app.auth import audit, policy
from app.auth.errors import ApiError
from app.auth.avatars_url import avatar_url
from app.models import Event, EventException, EventPerson, EventReminder, ReminderDismissal, User
from app.schedule.occurrences import EventData, ExceptionData, Occurrence, expand, own_dates
from app.schedule.recurrence import MAX_RANGE_DAYS, RecurrenceRule, first_date_on_or_after, series_dates
from app.schedule.schemas import EventIn

COMPANY_TZ = ZoneInfo("America/Toronto")
PALETTE = ("red", "orange", "amber", "green", "teal", "blue", "violet", "pink")
EVERYONE_COLOR = "teal"
MAX_REMINDERS = 10
MIN_SEARCH_LENGTH = 2
SERIES_FIELDS = ("icon", "color", "all_day", "ends_on", "max_count", "client_id", "property_id")


def avatar_color(user_id: int) -> str:
    return PALETTE[user_id % len(PALETTE)]


def display_name(user: User) -> str:
    return user.name or user.username


# ---- reading ----------------------------------------------------------------------------------------------------


def selectable_people(db: Session) -> list[dict]:
    """Everyone who can appear on an event: active users, plus disabled and deleted ones (flagged `active: false`) so
    the events they are on still show who they are. Only active ones may be newly added."""
    users = db.scalars(select(User).where(User.status.in_(("active", "disabled", "deleted")))).all()
    users.sort(key=lambda u: (u.status != "active", *names.sort_key(u.name, u.username)))
    return [{"id": u.id, "name": display_name(u), "color": avatar_color(u.id), "active": u.status == "active", "avatar_url": avatar_url(u)} for u in users]


def _rule(event: Event) -> RecurrenceRule | None:
    return RecurrenceRule.model_validate(event.recurrence) if event.recurrence else None


def _data(event: Event) -> EventData:
    return EventData(
        id=event.id, title=event.title, notes=event.notes, icon=event.icon, color=event.color, all_day=event.all_day,
        start_date=event.start_date, start_time=event.start_time, duration_minutes=event.duration_minutes,
        rule=_rule(event), ends_on=event.ends_on, max_count=event.max_count,
    )


def _people_of(db: Session, event_ids: list[int]) -> dict[int, frozenset[int]]:
    found: dict[int, set[int]] = {i: set() for i in event_ids}
    for event_id, user_id in db.execute(select(EventPerson.event_id, EventPerson.user_id).where(EventPerson.event_id.in_(event_ids))):
        found[event_id].add(user_id)
    return {i: frozenset(p) for i, p in found.items()}


def _exceptions_of(db: Session, event_ids: list[int]) -> dict[int, list[EventException]]:
    found: dict[int, list[EventException]] = {i: [] for i in event_ids}
    for x in db.scalars(select(EventException).where(EventException.event_id.in_(event_ids))):
        found[x.event_id].append(x)
    return found


def _exception_data(x: EventException) -> ExceptionData:
    return ExceptionData(x.original_date, x.cancelled, x.title, x.notes, x.start_date, x.start_time, x.duration_minutes)


def _hhmm(value: time | None) -> str | None:
    return value.strftime("%H:%M") if value is not None else None


def _fold(text: str) -> str:
    """Lower case without accents, for searching."""
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(c for c in decomposed if not unicodedata.combining(c)).casefold()


def _resolved_color(event: Event, people: frozenset[int]) -> str:
    if event.color:
        return event.color
    return avatar_color(min(people)) if people else EVERYONE_COLOR


def _occurrence_payload(o: Occurrence, event: Event, people: frozenset[int]) -> dict:
    return {
        "event_id": event.id,
        "original_date": o.original_date.isoformat(),
        "date": o.date.isoformat(),
        "start_time": _hhmm(o.start_time),
        "end_time": _hhmm(o.end_time),
        "all_day": o.all_day,
        "title": o.title,
        "notes": o.notes,
        "icon": event.icon,
        "color": _resolved_color(event, people),
        "repeating": o.repeating,
        "modified": o.modified,
        "people": sorted(people),
        "created_by": event.created_by,
        "client_id": event.client_id,
        "property_id": event.property_id,
    }


def list_occurrences(db: Session, from_: date, to: date, q: str | None, people: set[int] | None) -> list[dict]:
    if to < from_:
        raise ApiError(422, "bad_range")
    if (to - from_).days + 1 > MAX_RANGE_DAYS:
        raise ApiError(422, "range_too_large")
    events = db.scalars(
        select(Event).where(Event.start_date <= to, or_(Event.recurrence.is_not(None), Event.start_date >= from_))
    ).all()
    ids = [e.id for e in events]
    people_of = _people_of(db, ids)
    exceptions_of = _exceptions_of(db, ids)
    needle = _fold(q.strip()) if q and len(q.strip()) >= MIN_SEARCH_LENGTH else None
    name_of = {}
    if needle:
        name_of = {u.id: _fold(display_name(u)) for u in db.scalars(select(User))}

    found: list[tuple[Occurrence, dict]] = []
    for event in events:
        who = people_of[event.id]
        if people is not None and who and not (who & people):
            continue
        for o in expand(_data(event), [_exception_data(x) for x in exceptions_of[event.id]], from_, to):
            if needle:
                haystack = [_fold(o.title), _fold(o.notes or "")] + [name_of.get(p, "") for p in who]
                if not any(needle in h for h in haystack):
                    continue
            found.append((o, _occurrence_payload(o, event, who)))
    found.sort(key=lambda pair: (pair[0].date, pair[0].start_time is not None, pair[0].start_time or time.min, pair[0].event_id))
    return [payload for _, payload in found]


def assigned_occurrences(db: Session, user_id: int, from_: date, to: date) -> list[Occurrence]:
    """The occurrences of the events that list this person, in the range (for the personal feed).

    Strict: an event with no people (an event "for everyone") is not included, unlike the on-screen filter.
    """
    events = db.scalars(
        select(Event)
        .join(EventPerson, EventPerson.event_id == Event.id)
        .where(
            EventPerson.user_id == user_id,
            Event.start_date <= to,
            or_(Event.recurrence.is_not(None), Event.start_date >= from_),
        )
    ).all()
    exceptions_of = _exceptions_of(db, [e.id for e in events])
    found = [
        o
        for event in events
        for o in expand(_data(event), [_exception_data(x) for x in exceptions_of[event.id]], from_, to)
    ]
    found.sort(key=lambda o: (o.date, o.start_time is not None, o.start_time or time.min, o.event_id))
    return found


def event_payload(db: Session, event: Event) -> dict:
    people = _people_of(db, [event.id])[event.id]
    reminders = db.scalars(select(EventReminder).where(EventReminder.event_id == event.id).order_by(EventReminder.id)).all()
    exceptions = sorted(_exceptions_of(db, [event.id])[event.id], key=lambda x: x.original_date)
    return {
        "id": event.id,
        "title": event.title,
        "notes": event.notes,
        "icon": event.icon,
        "color": event.color,
        "display_color": _resolved_color(event, people),
        "all_day": event.all_day,
        "start_date": event.start_date.isoformat(),
        "start_time": _hhmm(event.start_time),
        "duration_minutes": event.duration_minutes,
        "recurrence": _rule(event).model_dump(mode="json") if event.recurrence else None,
        "ends_on": event.ends_on.isoformat() if event.ends_on else None,
        "max_count": event.max_count,
        "client_id": event.client_id,
        "property_id": event.property_id,
        "people": sorted(people),
        "reminders": [{"amount": r.amount, "unit": r.unit} for r in reminders],
        "exceptions": [
            {
                "original_date": x.original_date.isoformat(),
                "cancelled": x.cancelled,
                "title": x.title,
                "notes": x.notes,
                "start_date": x.start_date.isoformat() if x.start_date else None,
                "start_time": _hhmm(x.start_time),
                "duration_minutes": x.duration_minutes,
            }
            for x in exceptions
        ],
        "created_by": event.created_by,
        "updated_by": event.updated_by,
    }


def get_event(db: Session, event_id: int) -> Event:
    event = db.get(Event, event_id)
    if event is None:
        raise ApiError(404, "not_found")
    return event


# ---- writing ----------------------------------------------------------------------------------------------------


def _checked_people(db: Session, ids: list[int], keep: frozenset[int] = frozenset()) -> set[int]:
    """The people of an event. Only active users may be newly added; people already on the event stay even if their
    account was disabled or deleted since (otherwise the event could not be edited at all)."""
    wanted = set(ids)
    added = wanted - set(keep)
    if added:
        active = set(db.scalars(select(User.id).where(User.id.in_(added), User.status == "active")))
        if active != added:
            raise ApiError(422, "unknown_person")
    return wanted


def _checked_reminders(data: EventIn) -> list[tuple[int, str]]:
    if len(data.reminders) > MAX_REMINDERS:
        raise ApiError(422, "too_many_reminders")
    pairs = [(r.amount, r.unit) for r in data.reminders]
    if len(set(pairs)) != len(pairs):
        raise ApiError(422, "duplicate_reminder")
    return pairs


def _first_date(data: EventIn, snap: bool) -> date:
    """A repeating event starts on the first date its rule produces on or after the given one (`snap`)."""
    first = data.start_date
    if data.recurrence is not None and snap:
        first = first_date_on_or_after(first, data.recurrence, first)
        if first is None:
            raise ApiError(422, "no_occurrence")
    if data.ends_on is not None and data.ends_on < first:
        raise ApiError(422, "before_start")
    return first


def _write(event: Event, data: EventIn, first: date) -> None:
    event.title, event.notes, event.icon, event.color = data.title, data.notes, data.icon, data.color
    event.all_day, event.start_date, event.start_time = data.all_day, first, data.start_time
    event.duration_minutes = data.duration_minutes
    event.recurrence = data.recurrence.model_dump(mode="json") if data.recurrence else None
    event.ends_on, event.max_count = data.ends_on, data.max_count
    event.client_id, event.property_id = data.client_id, data.property_id


def _replace_links(db: Session, event_id: int, people: set[int], reminders: list[tuple[int, str]]) -> None:
    db.execute(delete(EventPerson).where(EventPerson.event_id == event_id))
    db.execute(delete(EventReminder).where(EventReminder.event_id == event_id))
    db.add_all([EventPerson(event_id=event_id, user_id=p) for p in sorted(people)])
    db.add_all([EventReminder(event_id=event_id, amount=a, unit=u) for a, u in reminders])


def create_event(db: Session, actor: User, data: EventIn, ip: str) -> Event:
    people = _checked_people(db, data.people)
    check_client(db, actor, data.client_id)
    check_property(db, actor, data.property_id, data.client_id)
    reminders = _checked_reminders(data)
    first = _first_date(data, snap=True)
    event = Event(created_by=actor.id, updated_by=actor.id)
    _write(event, data, first)
    db.add(event)
    db.flush()
    _replace_links(db, event.id, people, reminders)
    audit.log(db, "event_created", actor_user_id=actor.id, ip=ip, details={"event_id": event.id})
    db.flush()
    return event


def _effective_scope(event: Event, scope: str, occurrence_date: date | None) -> str:
    """A single event has only itself, and the first occurrence of a series starts the whole series."""
    if scope == "all":
        return "all"
    if occurrence_date is None:
        raise ApiError(422, "occurrence_date_required")
    if not own_dates(_data(event), occurrence_date, occurrence_date):
        raise ApiError(422, "not_an_occurrence")
    if event.recurrence is None or (scope == "following" and occurrence_date == event.start_date):
        return "all"
    return scope


def _changed_fields(event: Event, data: EventIn, people: set[int], old_people: frozenset[int], reminders, old_reminders) -> list[str]:
    changed = [f for f in ("title", "notes", "icon", "color", "all_day", "start_date", "start_time", "duration_minutes", "ends_on", "max_count", "client_id") if getattr(event, f) != getattr(data, f)]
    if (event.recurrence or None) != (data.recurrence.model_dump(mode="json") if data.recurrence else None):
        changed.append("recurrence")
    if people != set(old_people):
        changed.append("people")
    if set(reminders) != set(old_reminders):
        changed.append("reminders")
    return changed


def _require_series_fields_unchanged(event: Event, data: EventIn, people: set[int], old_people: frozenset[int], reminders, old_reminders) -> None:
    same = (
        people == set(old_people)
        and set(reminders) == set(old_reminders)
        and all(getattr(event, f) == getattr(data, f) for f in SERIES_FIELDS)
        and (event.recurrence or None) == (data.recurrence.model_dump(mode="json") if data.recurrence else None)
    )
    if not same:
        raise ApiError(422, "series_field_changed")


def _reminder_pairs(db: Session, event_id: int) -> list[tuple[int, str]]:
    return [(r.amount, r.unit) for r in db.scalars(select(EventReminder).where(EventReminder.event_id == event_id))]


def _end_series_before(db: Session, event: Event, day: date, actor: User) -> None:
    event.ends_on, event.max_count = day - timedelta(days=1), None
    event.updated_by, event.updated_at = actor.id, func.now()
    db.execute(delete(EventException).where(EventException.event_id == event.id, EventException.original_date >= day))


def update_event(db: Session, actor: User, event_id: int, data: EventIn, ip: str) -> Event:
    event = get_event(db, event_id)
    old_people = _people_of(db, [event.id])[event.id]
    policy.check_event(actor, event.created_by, old_people)
    scope = _effective_scope(event, data.scope, data.occurrence_date)
    people = _checked_people(db, data.people, keep=old_people)
    check_client(db, actor, data.client_id, event.client_id)
    check_property(db, actor, data.property_id, data.client_id)
    reminders = _checked_reminders(data)
    old_reminders = _reminder_pairs(db, event.id)
    details = {"event_id": event.id, "scope": scope}

    if scope == "all":
        first = _first_date(data, snap=True)
        details["fields"] = _changed_fields(event, data.model_copy(update={"start_date": first}), people, old_people, reminders, old_reminders)
        _write(event, data, first)
        event.updated_by, event.updated_at = actor.id, func.now()
        _replace_links(db, event.id, people, reminders)
        result = event
    elif scope == "this":
        first = data.start_date  # where this occurrence moves to; it is not a series start, so no snapping
        _require_series_fields_unchanged(event, data, people, old_people, reminders, old_reminders)
        details["fields"] = ["title", "notes", "start_date", "start_time", "duration_minutes"]
        details["occurrence_date"] = data.occurrence_date.isoformat()
        db.merge(
            EventException(
                event_id=event.id, original_date=data.occurrence_date, cancelled=False, title=data.title, notes=data.notes,
                start_date=first, start_time=data.start_time, duration_minutes=data.duration_minutes,
            )
        )
        result = event
    else:  # following: end the series the day before, start a new one from this occurrence
        tail_data = data
        if event.max_count is not None and data.max_count == event.max_count:  # the tail carries what the old series had left
            used = len(series_dates(event.start_date, _rule(event), event.ends_on, event.max_count, event.start_date, data.occurrence_date - timedelta(days=1)))
            tail_data = data.model_copy(update={"max_count": max(1, event.max_count - used)})
        first = _first_date(tail_data, snap=True)
        tail = Event(created_by=event.created_by, updated_by=actor.id)  # the creator keeps their rights on the new series
        _write(tail, tail_data, first)
        _end_series_before(db, event, data.occurrence_date, actor)
        db.add(tail)
        db.flush()
        _replace_links(db, tail.id, people, reminders)
        details.update(new_event_id=tail.id, occurrence_date=data.occurrence_date.isoformat())
        result = tail
    audit.log(db, "event_updated", actor_user_id=actor.id, ip=ip, details=details)
    db.flush()
    return result


def delete_event(db: Session, actor: User, event_id: int, scope: str, occurrence_date: date | None, ip: str) -> None:
    event = get_event(db, event_id)
    policy.check_event(actor, event.created_by, _people_of(db, [event.id])[event.id])
    effective = _effective_scope(event, scope, occurrence_date)
    if effective == "all":
        db.execute(delete(Event).where(Event.id == event.id))
    elif effective == "this":
        db.merge(EventException(event_id=event.id, original_date=occurrence_date, cancelled=True))
    else:
        _end_series_before(db, event, occurrence_date, actor)
    details = {"event_id": event.id, "scope": effective}
    if occurrence_date is not None and effective != "all":
        details["occurrence_date"] = occurrence_date.isoformat()
    audit.log(db, "event_deleted", actor_user_id=actor.id, ip=ip, details=details)
    db.flush()


# ---- reminders ----------------------------------------------------------------------------------------------------

LEAD = {"hours": timedelta(hours=1), "days": timedelta(days=1), "weeks": timedelta(weeks=1)}
REMINDER_GRACE = timedelta(days=1)  # a reminder stays up to a day after its occurrence started


def now_toronto() -> datetime:
    """The company wall clock (naive), the one thing tests replace."""
    return datetime.now(COMPANY_TZ).replace(tzinfo=None)


def due_reminders(db: Session, user: User) -> list[dict]:
    """One entry per occurrence (of an event for this user or for everyone) whose earliest reminder has passed, that
    started no more than a day ago and that the user has not dismissed. Dismissing hides all its reminders."""
    now = now_toronto()
    leads: dict[int, list[timedelta]] = {}
    for event_id, amount, unit in db.execute(select(EventReminder.event_id, EventReminder.amount, EventReminder.unit)):
        leads.setdefault(event_id, []).append(LEAD[unit] * amount)
    if not leads:
        return []
    events = db.scalars(select(Event).where(Event.id.in_(leads))).all()
    people_of = _people_of(db, list(leads))
    exceptions_of = _exceptions_of(db, list(leads))
    dismissed = set(
        db.execute(select(ReminderDismissal.event_id, ReminderDismissal.occurrence_date).where(ReminderDismissal.user_id == user.id)).all()
    )
    first_day = (now - REMINDER_GRACE).date()
    found = []
    for event in events:
        who = people_of[event.id]
        if who and user.id not in who:
            continue
        last_day = min((now + max(leads[event.id])).date(), first_day + timedelta(days=MAX_RANGE_DAYS - 1))
        if last_day < first_day:
            continue
        for o in expand(_data(event), [_exception_data(x) for x in exceptions_of[event.id]], first_day, last_day):
            start = datetime.combine(o.date, o.start_time or time.min)
            if start < now - REMINDER_GRACE or (event.id, o.original_date) in dismissed:
                continue
            remind_at = min(start - lead for lead in leads[event.id])
            if remind_at <= now:
                found.append((start, o, remind_at))
    found.sort(key=lambda item: (item[0], item[1].event_id))
    return [
        {
            "event_id": o.event_id,
            "occurrence_date": o.original_date.isoformat(),
            "title": o.title,
            "start_date": o.date.isoformat(),
            "start_time": _hhmm(o.start_time),
            "all_day": o.all_day,
            "remind_at": remind_at.strftime("%Y-%m-%dT%H:%M"),
        }
        for _, o, remind_at in found
    ]


def dismiss_reminder(db: Session, user: User, event_id: int, occurrence_date: date) -> None:
    get_event(db, event_id)
    db.merge(ReminderDismissal(user_id=user.id, event_id=event_id, occurrence_date=occurrence_date))
    db.flush()
