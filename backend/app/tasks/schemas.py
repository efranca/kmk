"""Request bodies of the tasks API."""

import unicodedata
from datetime import date
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schedule.schemas import FIRST_DAY, LAST_DAY, MAX_ID

CATEGORY_NAME_MAX = 50
ICON_MAX = 16


def _clean_icon(v: str | None) -> str | None:
    return (v.strip() or None) if v is not None else None


class CategoryIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    icon: str | None = Field(default=None, max_length=ICON_MAX)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = unicodedata.normalize("NFC", v).strip()
        if not 1 <= len(v) <= CATEGORY_NAME_MAX or any(unicodedata.category(c) in ("Cc", "Cf") for c in v):
            raise ValueError(f"the name must be 1 to {CATEGORY_NAME_MAX} characters, without control characters")
        return v

    @field_validator("icon")
    @classmethod
    def _icon(cls, v: str | None) -> str | None:
        return _clean_icon(v)


TITLE_MAX = 200
DESCRIPTION_MAX = 2000
PEOPLE_MAX = 50


class TaskIn(BaseModel):
    """The body of POST and PATCH (PATCH sends the whole form, as the schedule does)."""

    model_config = ConfigDict(extra="forbid")

    title: str
    description: str | None = None
    icon: str | None = Field(default=None, max_length=ICON_MAX)
    category_id: int | None = Field(default=None, ge=1, le=MAX_ID)
    people: list[Annotated[int, Field(ge=1, le=MAX_ID)]] = Field(default_factory=list, max_length=PEOPLE_MAX)
    due_date: date | None = None
    show_on_dashboard: bool = True

    @field_validator("title")
    @classmethod
    def _title(cls, v: str) -> str:
        v = unicodedata.normalize("NFC", v).strip()
        if not 1 <= len(v) <= TITLE_MAX or any(unicodedata.category(c) in ("Cc", "Cf") for c in v):
            raise ValueError(f"the title must be 1 to {TITLE_MAX} characters, without control characters")
        return v

    @field_validator("description")
    @classmethod
    def _description(cls, v: str | None) -> str | None:
        if v is None or not v.strip():
            return None
        if len(v.strip()) > DESCRIPTION_MAX:
            raise ValueError(f"the description is at most {DESCRIPTION_MAX} characters")
        return v.strip()

    @field_validator("icon")
    @classmethod
    def _icon(cls, v: str | None) -> str | None:
        return _clean_icon(v)

    @field_validator("due_date")
    @classmethod
    def _sane_date(cls, v: date | None) -> date | None:
        if v is not None and not FIRST_DAY <= v <= LAST_DAY:
            raise ValueError("the date is out of range")
        return v
