"""Request bodies of the tasks API."""

import unicodedata

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schedule.schemas import MAX_ID

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
