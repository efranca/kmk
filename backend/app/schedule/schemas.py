"""Request bodies of the schedule API."""

import unicodedata
from datetime import date, time
from typing import Annotated, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schedule.recurrence import RecurrenceRule

Color = Literal["red", "orange", "amber", "green", "teal", "blue", "violet", "pink"]
Scope = Literal["this", "following", "all"]
TITLE_MAX = 200
NOTES_MAX = 5000
PEOPLE_MAX = 100
MAX_ID = 2**63 - 1  # the database's bigint
MAX_COUNT = 1000
FIRST_DAY, LAST_DAY = date(2000, 1, 1), date(2100, 12, 31)


class ReminderIn(BaseModel):
    amount: int = Field(ge=1, le=99)
    unit: Literal["hours", "days", "weeks"]


class EventIn(BaseModel):
    """The body of POST and PATCH. `scope` and `occurrence_date` only matter for PATCH of a repeating event."""

    title: str
    notes: str | None = None
    icon: str | None = Field(default=None, max_length=16)
    color: Color | None = None
    all_day: bool = False
    start_date: date
    start_time: time | None = None
    duration_minutes: int | None = Field(default=None, ge=1, le=1440)
    recurrence: RecurrenceRule | None = None
    ends_on: date | None = None
    max_count: int | None = Field(default=None, ge=1, le=MAX_COUNT)
    client_id: int | None = Field(default=None, ge=1, le=MAX_ID)
    property_id: int | None = Field(default=None, ge=1, le=MAX_ID)
    people: list[Annotated[int, Field(ge=1, le=MAX_ID)]] = Field(default_factory=list, max_length=PEOPLE_MAX)
    reminders: list[ReminderIn] = Field(default_factory=list)
    scope: Scope = "all"
    occurrence_date: date | None = None

    @field_validator("title")
    @classmethod
    def _title(cls, v: str) -> str:
        v = unicodedata.normalize("NFC", v).strip()
        if not 1 <= len(v) <= TITLE_MAX or any(unicodedata.category(c) in ("Cc", "Cf") for c in v):
            raise ValueError(f"the title must be 1 to {TITLE_MAX} characters, without control characters")
        return v

    @field_validator("notes")
    @classmethod
    def _notes(cls, v: str | None) -> str | None:
        if v is None or not v.strip():
            return None
        if len(v) > NOTES_MAX:
            raise ValueError(f"the notes are at most {NOTES_MAX} characters")
        return v.strip()

    @field_validator("icon")
    @classmethod
    def _icon(cls, v: str | None) -> str | None:
        return v.strip() or None if v is not None else None

    @field_validator("start_date", "ends_on", "occurrence_date")
    @classmethod
    def _sane_date(cls, v: date | None) -> date | None:
        if v is not None and not FIRST_DAY <= v <= LAST_DAY:
            raise ValueError("the date must be between the years 2000 and 2100")
        return v

    @model_validator(mode="after")
    def _shape(self) -> "EventIn":
        if self.all_day and self.start_time is not None:
            raise ValueError("an all-day event has no start time")
        if not self.all_day and self.start_time is None:
            raise ValueError("a timed event needs a start time")
        if self.all_day:
            self.duration_minutes = None
        if self.ends_on is not None and self.max_count is not None:
            raise ValueError("use an end date or a number of times, not both")
        if self.recurrence is None and (self.ends_on is not None or self.max_count is not None):
            raise ValueError("only a repeating event can have an end")
        return self


class DismissIn(BaseModel):
    event_id: int = Field(ge=1, le=MAX_ID)
    occurrence_date: date
