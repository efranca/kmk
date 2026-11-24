"""Expanding an event into its occurrences. Ported from FamillAI's OccurrencesTest (expected dates verbatim)."""

from datetime import date, time

import pytest

from app.schedule.occurrences import ExceptionData, EventData, expand
from app.schedule.recurrence import RecurrenceRule

SIX_PM = time(18, 0)


def d(iso: str) -> date:
    return date.fromisoformat(iso)


def weekly(*days: str, interval: int = 1) -> RecurrenceRule:
    return RecurrenceRule(freq="weekly", interval=interval, weekdays=list(days))


def event(start="2026-11-05", at=SIX_PM, duration=None, rule=None, ends_on=None, max_count=None) -> EventData:
    return EventData(
        id=1, title="Swimming", notes=None, icon=None, color=None, all_day=at is None,
        start_date=d(start), start_time=at, duration_minutes=duration, rule=rule,
        ends_on=d(ends_on) if ends_on else None, max_count=max_count,
    )


def exc(original, cancelled=False, title=None, notes=None, start_date=None, start_time=None, duration=None):
    return ExceptionData(
        original_date=d(original), cancelled=cancelled, title=title, notes=notes,
        start_date=d(start_date) if start_date else None, start_time=start_time, duration_minutes=duration,
    )


def dates(occurrences):
    return [o.date for o in occurrences]


def run(e, frm, to, *exceptions):
    return expand(e, list(exceptions), d(frm), d(to))


def test_weekly_event_expands_with_its_time():
    result = run(event(rule=weekly("THU")), "2026-11-01", "2026-11-30")
    assert dates(result) == [d("2026-11-05"), d("2026-11-12"), d("2026-11-19"), d("2026-11-26")]
    assert all(o.start_time == SIX_PM and o.repeating and not o.modified for o in result)


def test_cancelled_exception_removes_that_day_only():
    result = run(event(rule=weekly("THU")), "2026-11-01", "2026-11-30", exc("2026-11-12", cancelled=True))
    assert dates(result) == [d("2026-11-05"), d("2026-11-19"), d("2026-11-26")]


def test_max_count_counts_cancelled_occurrences():
    e = event(rule=weekly("THU"), max_count=3)
    result = run(e, "2026-11-01", "2026-12-31", exc("2026-11-12", cancelled=True))
    assert dates(result) == [d("2026-11-05"), d("2026-11-19")]


def test_modified_exception_moves_one_occurrence():
    e = event(rule=weekly("THU"))
    moved = exc("2026-11-12", title="Swimming (moved)", start_date="2026-11-13", start_time=time(10, 0))
    in_month = run(e, "2026-11-01", "2026-11-30", moved)
    assert dates(in_month) == [d("2026-11-05"), d("2026-11-13"), d("2026-11-19"), d("2026-11-26")]
    edited = in_month[1]
    assert edited.original_date == d("2026-11-12")
    assert edited.start_time == time(10, 0)
    assert edited.title == "Swimming (moved)"
    assert edited.modified
    # the new date alone is enough to show it; the old date no longer shows anything
    assert dates(run(e, "2026-11-13", "2026-11-13", moved)) == [d("2026-11-13")]
    assert dates(run(e, "2026-11-12", "2026-11-12", moved)) == []


def test_non_repeating_event_is_one_occurrence_if_in_range():
    e = event()
    assert dates(run(e, "2026-11-01", "2026-11-30")) == [d("2026-11-05")]
    assert dates(run(e, "2026-12-01", "2026-12-31")) == []
    assert not run(e, "2026-11-01", "2026-11-30")[0].repeating


def test_all_day_occurrence_has_no_times_and_sorts_first():
    all_day = event(at=None)
    o = run(all_day, "2026-11-05", "2026-11-05")[0]
    assert o.all_day and o.start_time is None and o.end_time is None
    both = [*expand(event(), [], d("2026-11-05"), d("2026-11-05")), o]
    assert [x.all_day for x in sorted(both, key=lambda x: (x.date, x.start_time is not None))] == [True, False]


def test_default_duration_is_one_hour():
    assert run(event(), "2026-11-05", "2026-11-05")[0].end_time == time(19, 0)
    assert run(event(duration=90), "2026-11-05", "2026-11-05")[0].end_time == time(19, 30)


def test_end_is_clamped_to_the_end_of_the_day():
    late = run(event(at=time(23, 30)), "2026-11-05", "2026-11-05")[0]
    assert late.end_time == time(23, 59)


def test_exception_overrides_title_notes_and_duration():
    e = event(rule=weekly("THU"))
    o = run(e, "2026-11-12", "2026-11-12", exc("2026-11-12", title="Gala", notes="Bring towels", duration=30))[0]
    assert (o.title, o.notes, o.end_time) == ("Gala", "Bring towels", time(18, 30))


def test_range_longer_than_400_days_is_rejected():
    e = event(start="2026-01-01", rule=weekly("THU"))
    with pytest.raises(ValueError):
        run(e, "2026-01-01", "2027-02-10")
    assert run(e, "2026-01-01", "2027-01-05")  # 370 days is fine


def test_reversed_range_is_rejected():
    with pytest.raises(ValueError):
        run(event(start="2026-01-01"), "2026-02-01", "2026-01-01")


def test_series_keeps_wall_clock_across_dst():
    # Toronto clocks went back on 2026-11-01 and forward on 2026-03-08: nothing is converted
    autumn = run(event(start="2026-10-22", rule=weekly("THU")), "2026-10-22", "2026-11-12")
    assert len(autumn) == 4 and all(o.start_time == SIX_PM for o in autumn)
    spring = run(event(start="2026-03-05", rule=weekly("THU")), "2026-03-05", "2026-03-12")
    assert dates(spring) == [d("2026-03-05"), d("2026-03-12")] and all(o.start_time == SIX_PM for o in spring)
