"""Request bodies of the documents API."""

import unicodedata
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schedule.schemas import MAX_ID
from app.tasks.schemas import CategoryIn as CategoryIn  # same rules as task categories: name 1-50 characters, an optional emoji

TITLE_MAX = 200
NOTE_MAX = 1000

Visibility = Literal["everyone", "admins", "superadmin"]
CategoryRef = Annotated[int, Field(ge=1, le=MAX_ID)]


def _title(v: str) -> str:
    v = unicodedata.normalize("NFC", v).strip()
    if not 1 <= len(v) <= TITLE_MAX or any(unicodedata.category(c) in ("Cc", "Cf") for c in v):
        raise ValueError(f"the title must be 1 to {TITLE_MAX} characters, without control characters")
    return v


def _note(v: str | None) -> str | None:
    if v is None:
        return None
    v = unicodedata.normalize("NFC", v).strip()
    if len(v) > NOTE_MAX or any(unicodedata.category(c) in ("Cc", "Cf") and c not in "\n\t" for c in v):
        raise ValueError(f"the note must be at most {NOTE_MAX} characters, without control characters")
    return v or None


class DocumentIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str
    note: str | None = None
    category_id: CategoryRef | None = None
    visibility: Visibility = "admins"  # fail closed

    _t = field_validator("title")(_title)
    _n = field_validator("note")(_note)


class DocumentPatch(BaseModel):
    """Any subset; what is sent is changed (so `category_id: null` removes the category)."""

    model_config = ConfigDict(extra="forbid")

    title: str | None = None
    note: str | None = None
    category_id: CategoryRef | None = None
    visibility: Visibility | None = None

    @field_validator("title")
    @classmethod
    def _title_if_given(cls, v: str | None) -> str | None:
        if v is None:
            raise ValueError("the title cannot be removed")
        return _title(v)

    _n = field_validator("note")(_note)

    @field_validator("visibility")
    @classmethod
    def _visibility_if_given(cls, v: str | None) -> str | None:
        if v is None:
            raise ValueError("the visibility cannot be removed")
        return v
