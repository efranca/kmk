"""Repeat rules and series dates. The cases are ported from FamillAI's OccurrencesTest (expected dates verbatim)."""

from datetime import date

import pytest
from pydantic import ValidationError

from app.schedule.recurrence import NthWeekday, RecurrenceRule, first_date_on_or_after, series_dates


def d(iso: str) -> date:
    return date.fromisoformat(iso)


def weekly(interval: int, *days: str) -> RecurrenceRule:
    return RecurrenceRule(freq="weekly", interval=interval, weekdays=list(days))


def monthly_day(day: int) -> RecurrenceRule:
    return RecurrenceRule(freq="monthly", month_day=day)


def monthly_nth(*nth: tuple[int, str]) -> RecurrenceRule:
    return RecurrenceRule(freq="monthly", nth_weekdays=[NthWeekday(nth=n, day=day) for n, day in nth])


def dates(start, rule, frm, to, ends_on=None, max_count=None):
    return series_dates(d(start), rule, d(ends_on) if ends_on else None, max_count, d(frm), d(to))


def test_weekly_thursday_gives_every_thursday():
    assert dates("2026-11-05", weekly(1, "THU"), "2026-11-01", "2026-11-30") == [
        d("2026-11-05"), d("2026-11-12"), d("2026-11-19"), d("2026-11-26"),
    ]


def test_every_two_weeks_on_monday_and_wednesday():
    assert dates("2026-11-02", weekly(2, "MON", "WED"), "2026-11-02", "2026-11-30") == [
        d("2026-11-02"), d("2026-11-04"), d("2026-11-16"), d("2026-11-18"), d("2026-11-30"),
    ]


def test_interval_phase_is_kept_when_the_range_starts_later():
    assert dates("2026-11-02", weekly(2, "MON", "WED"), "2026-11-09", "2026-11-22") == [d("2026-11-16"), d("2026-11-18")]
    daily3 = RecurrenceRule(freq="daily", interval=3)
    assert dates("2026-11-01", daily3, "2026-11-05", "2026-11-10") == [d("2026-11-07"), d("2026-11-10")]


def test_twice_a_week_means_two_weekdays():
    assert dates("2026-11-03", weekly(1, "TUE", "THU"), "2026-11-03", "2026-11-09") == [d("2026-11-03"), d("2026-11-05")]


def test_monthly_fourth_saturday_november_2026_is_28th():
    assert dates("2026-11-01", monthly_nth((4, "SAT")), "2026-11-01", "2026-11-30") == [d("2026-11-28")]


def test_first_and_third_saturday():
    rule = monthly_nth((1, "SAT"), (3, "SAT"))
    assert dates("2026-11-01", rule, "2026-11-01", "2026-12-31") == [
        d("2026-11-07"), d("2026-11-21"), d("2026-12-05"), d("2026-12-19"),
    ]


def test_fifth_saturday_skips_months_without_one():
    # Nov, Dec, Feb and Mar 2026-27 have only four Saturdays
    assert dates("2026-11-01", monthly_nth((5, "SAT")), "2026-11-01", "2027-03-31") == [d("2027-01-30")]


def test_monthly_31st_skips_short_months():
    assert dates("2026-01-31", monthly_day(31), "2026-01-01", "2026-06-30") == [
        d("2026-01-31"), d("2026-03-31"), d("2026-05-31"),
    ]


def test_yearly_feb_29_only_in_leap_years():
    rule = RecurrenceRule(freq="yearly")
    assert dates("2024-02-29", rule, "2024-01-01", "2024-12-31") == [d("2024-02-29")]
    assert dates("2024-02-29", rule, "2025-01-01", "2025-12-31") == []
    assert dates("2024-02-29", rule, "2027-01-01", "2027-12-31") == []
    assert dates("2024-02-29", rule, "2028-01-01", "2028-12-31") == [d("2028-02-29")]


def test_yearly_repeats_the_start_date():
    rule = RecurrenceRule(freq="yearly")
    assert dates("2025-06-15", rule, "2026-01-01", "2026-12-31") == [d("2026-06-15")]
    assert dates("2025-06-15", rule, "2027-01-01", "2027-12-31") == [d("2027-06-15")]


def test_ends_on_is_inclusive():
    assert dates("2026-11-05", weekly(1, "THU"), "2026-11-01", "2026-11-30", ends_on="2026-11-19") == [
        d("2026-11-05"), d("2026-11-12"), d("2026-11-19"),
    ]


def test_max_count_counts_from_start():
    assert dates("2026-11-05", weekly(1, "THU"), "2026-11-01", "2026-12-31", max_count=3) == [
        d("2026-11-05"), d("2026-11-12"), d("2026-11-19"),
    ]
    # a later range still numbers the occurrences from the series start
    assert dates("2026-11-05", weekly(1, "THU"), "2026-11-15", "2026-12-31", max_count=3) == [d("2026-11-19")]


def test_weekly_first_week_ignores_weekdays_before_the_start():
    # started on a Thursday: the Monday of that same week is not an occurrence
    assert dates("2026-11-05", weekly(1, "MON", "THU"), "2026-11-01", "2026-11-12") == [
        d("2026-11-05"), d("2026-11-09"), d("2026-11-12"),
    ]


def test_first_date_on_or_after_moves_to_the_rule():
    rule = weekly(1, "THU")
    assert first_date_on_or_after(d("2026-11-03"), rule, d("2026-11-03")) == d("2026-11-05")
    assert first_date_on_or_after(d("2026-11-05"), rule, d("2026-11-05")) == d("2026-11-05")


def test_weekly_rule_without_weekdays_is_rejected():
    with pytest.raises(ValidationError):
        RecurrenceRule(freq="weekly", weekdays=[])


def test_weekly_rule_with_month_day_is_rejected():
    with pytest.raises(ValidationError):
        RecurrenceRule(freq="weekly", weekdays=["MON"], month_day=3)


def test_monthly_rule_with_both_day_and_nth_is_rejected():
    with pytest.raises(ValidationError):
        RecurrenceRule(freq="monthly", month_day=5, nth_weekdays=[NthWeekday(nth=1, day="SAT")])


def test_monthly_rule_with_neither_is_rejected():
    with pytest.raises(ValidationError):
        RecurrenceRule(freq="monthly")


def test_daily_rule_takes_only_an_interval():
    with pytest.raises(ValidationError):
        RecurrenceRule(freq="daily", weekdays=["MON"])


@pytest.mark.parametrize("interval", [0, 100])
def test_interval_out_of_range_is_rejected(interval):
    with pytest.raises(ValidationError):
        RecurrenceRule(freq="daily", interval=interval)


def test_nth_weekday_out_of_range_is_rejected():
    with pytest.raises(ValidationError):
        NthWeekday(nth=6, day="SAT")


def test_more_than_five_nth_weekdays_is_rejected():
    with pytest.raises(ValidationError):
        monthly_nth((1, "MON"), (1, "TUE"), (1, "WED"), (1, "THU"), (1, "FRI"), (1, "SAT"))


def test_nth_weekdays_are_deduplicated_and_sorted():
    rule = monthly_nth((3, "SAT"), (1, "SAT"), (1, "SAT"))
    assert [(n.nth, n.day) for n in rule.nth_weekdays] == [(1, "SAT"), (3, "SAT")]


def test_rule_round_trips_through_json():
    rule = monthly_nth((1, "SAT"), (3, "SAT"))
    assert RecurrenceRule.model_validate(rule.model_dump(mode="json")) == rule
    assert rule.model_dump(mode="json")["freq"] == "monthly"
