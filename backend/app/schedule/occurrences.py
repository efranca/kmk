"""Expanding an event (one date, or a repeating series) into the days it takes place on, for a date range.

Pure: no database, no clock, no time zones. Dates and times are the company's wall-clock values, so "Thursday 18:00"
is 18:00 on every Thursday, daylight saving or not.
"""

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

from app.schedule.recurrence import MAX_RANGE_DAYS, RecurrenceRule, series_dates

DEFAULT_DURATION_MINUTES = 60
END_OF_DAY = time(23, 59)


@dataclass(frozen=True)
class EventData:
    id: int
    title: str
    notes: str | None
    icon: str | None
    color: str | None
    all_day: bool
    start_date: date
    start_time: time | None
    duration_minutes: int | None
    rule: RecurrenceRule | None
    ends_on: date | None
    max_count: int | None


@dataclass(frozen=True)
class ExceptionData:
    """A "this occurrence only" change: the occurrence is cancelled, or some of its fields are overridden."""

    original_date: date
    cancelled: bool
    title: str | None = None
    notes: str | None = None
    start_date: date | None = None
    start_time: time | None = None
    duration_minutes: int | None = None


@dataclass(frozen=True)
class Occurrence:
    event_id: int
    original_date: date
    date: date
    start_time: time | None
    end_time: time | None
    all_day: bool
    title: str
    notes: str | None
    repeating: bool
    modified: bool


def own_dates(event: EventData, from_: date, to: date) -> list[date]:
    """The series' own dates inside the range (before any exception), honouring the end rule."""
    if event.rule is None:
        return [event.start_date] if from_ <= event.start_date <= to else []
    return series_dates(event.start_date, event.rule, event.ends_on, event.max_count, from_, to)


def _end_time(start: time, minutes: int) -> time:
    end = datetime.combine(date.min, start) + timedelta(minutes=minutes)
    return END_OF_DAY if end.date() != date.min else end.time()


def expand(event: EventData, exceptions: list[ExceptionData], from_: date, to: date) -> list[Occurrence]:
    """Occurrences with `from_ <= date <= to` (inclusive), ordered by date then start time (all-day first).

    Cancelled occurrences are dropped; modified ones appear at their new date, even when their original date is
    outside the range. A series ends at `ends_on` or after `max_count` occurrences, counted from the series start
    and including cancelled ones.
    """
    if to < from_:
        raise ValueError("to must not be before from")
    if (to - from_).days + 1 > MAX_RANGE_DAYS:
        raise ValueError(f"the range is at most {MAX_RANGE_DAYS} days")
    by_original = {x.original_date: x for x in exceptions}
    originals = own_dates(event, from_, to)
    for x in exceptions:  # a moved occurrence can have its original date outside the range and its new one inside
        if (
            not x.cancelled
            and x.start_date is not None
            and from_ <= x.start_date <= to
            and not from_ <= x.original_date <= to
            and own_dates(event, x.original_date, x.original_date)
        ):
            originals.append(x.original_date)

    result: list[Occurrence] = []
    for original in originals:
        x = by_original.get(original)
        if x is not None and x.cancelled:
            continue
        day = x.start_date if x is not None and x.start_date is not None else original
        if not from_ <= day <= to:
            continue
        start = end = None
        if not event.all_day:
            start = x.start_time if x is not None and x.start_time is not None else event.start_time
            minutes = x.duration_minutes if x is not None and x.duration_minutes is not None else event.duration_minutes
            end = _end_time(start, minutes if minutes is not None else DEFAULT_DURATION_MINUTES)
        result.append(
            Occurrence(
                event_id=event.id,
                original_date=original,
                date=day,
                start_time=start,
                end_time=end,
                all_day=event.all_day,
                title=x.title if x is not None and x.title is not None else event.title,
                notes=x.notes if x is not None and x.notes is not None else event.notes,
                repeating=event.rule is not None,
                modified=x is not None,
            )
        )
    result.sort(key=lambda o: (o.date, o.start_time is not None, o.start_time or time.min))
    return result
