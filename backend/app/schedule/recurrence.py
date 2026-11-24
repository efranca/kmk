"""The repeat rule of an event and the dates of a repeating series.

The rule's JSON shape is FamillAI's: `{"freq": "weekly", "interval": 1, "weekdays": ["THU"], "month_day": null,
"nth_weekdays": [{"nth": 4, "day": "SAT"}]}`. Dates are plain calendar dates (no time zone): "Thursday" is Thursday.
Series dates come from `dateutil.rrule`, anchored on the start date; weeks start on Monday, so "every 2 weeks"
keeps its phase. A month without the requested day (the 31st, a 5th Saturday) has no occurrence.
"""

from datetime import date, datetime, time, timedelta
from typing import Literal

from dateutil import rrule
from pydantic import BaseModel, Field, model_validator

Day = Literal["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]
DAYS: tuple[str, ...] = ("MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN")
MAX_INTERVAL = 99
MAX_NTH_WEEKDAYS = 5
MAX_RANGE_DAYS = 400

_WEEKDAYS = (rrule.MO, rrule.TU, rrule.WE, rrule.TH, rrule.FR, rrule.SA, rrule.SU)


class NthWeekday(BaseModel):
    """"The nth day of the month": nth is 1 to 5 (a month without a 5th such weekday has no occurrence)."""

    nth: int = Field(ge=1, le=5)
    day: Day


class RecurrenceRule(BaseModel):
    freq: Literal["daily", "weekly", "monthly", "yearly"]
    interval: int = Field(default=1, ge=1, le=MAX_INTERVAL)
    weekdays: list[Day] = []
    month_day: int | None = Field(default=None, ge=1, le=31)
    nth_weekdays: list[NthWeekday] = []

    @model_validator(mode="after")
    def _shape(self) -> "RecurrenceRule":
        self.weekdays = sorted(set(self.weekdays), key=DAYS.index)
        seen = {(n.nth, n.day) for n in self.nth_weekdays}
        self.nth_weekdays = [NthWeekday(nth=n, day=day) for n, day in sorted(seen, key=lambda p: (p[0], DAYS.index(p[1])))]
        if len(self.nth_weekdays) > MAX_NTH_WEEKDAYS:
            raise ValueError(f"nth_weekdays: at most {MAX_NTH_WEEKDAYS}")
        if self.freq == "weekly":
            if not self.weekdays:
                raise ValueError("weekdays: choose at least one weekday")
            if self.month_day is not None or self.nth_weekdays:
                raise ValueError("a weekly rule has only weekdays")
        elif self.freq == "monthly":
            if (self.month_day is None) == (not self.nth_weekdays):
                raise ValueError("a monthly rule is either a day of the month or the nth weekdays, not both")
            if self.weekdays:
                raise ValueError("weekdays: not used by a monthly rule")
        elif self.weekdays or self.month_day is not None or self.nth_weekdays:
            raise ValueError(f"a {self.freq} rule takes only an interval")
        return self


_FREQ = {"daily": rrule.DAILY, "weekly": rrule.WEEKLY, "monthly": rrule.MONTHLY, "yearly": rrule.YEARLY}


def _build(start: date, rule: RecurrenceRule, ends_on: date | None, max_count: int | None) -> rrule.rrule:
    options: dict = {}
    if rule.freq == "weekly":
        options["byweekday"] = [_WEEKDAYS[DAYS.index(d)] for d in rule.weekdays]
        options["wkst"] = rrule.MO
    elif rule.freq == "monthly":
        if rule.month_day is not None:
            options["bymonthday"] = rule.month_day
        else:
            options["byweekday"] = [_WEEKDAYS[DAYS.index(n.day)](n.nth) for n in rule.nth_weekdays]
    elif rule.freq == "yearly":
        options["bymonth"] = start.month
        options["bymonthday"] = start.day
    if ends_on is not None:
        options["until"] = datetime.combine(ends_on, time.max)
    if max_count is not None:
        options["count"] = max_count
    return rrule.rrule(_FREQ[rule.freq], interval=rule.interval, dtstart=datetime.combine(start, time.min), **options)


def series_dates(
    start: date, rule: RecurrenceRule, ends_on: date | None, max_count: int | None, from_: date, to: date
) -> list[date]:
    """Dates of the series with `from_ <= date <= to` (inclusive), ascending, before any exception.

    `max_count` counts from `start`, whatever the range, so a series has the same dates however it is read.
    """
    series = _build(start, rule, ends_on, max_count)
    found = series.between(datetime.combine(from_, time.min), datetime.combine(to, time.max), inc=True)
    return [moment.date() for moment in found]


def first_date_on_or_after(start: date, rule: RecurrenceRule, day: date) -> date | None:
    """The first date on or after `day` that the series produces (looking 400 days ahead), or None."""
    found = series_dates(start, rule, None, None, day, day + timedelta(days=MAX_RANGE_DAYS - 1))
    return found[0] if found else None
