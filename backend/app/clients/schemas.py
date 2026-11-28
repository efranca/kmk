"""Request bodies of the clients API."""

import re
import unicodedata
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.auth.admin import clean_email
from app.invoices.money import parse_amount
from app.quotes.schemas import PHONE_RE
from app.schedule.schemas import MAX_ID

KINDS = ("airbnb", "commercial", "post_construction", "other")
Kind = Literal["airbnb", "commercial", "post_construction", "other"]
NOTES_MAX = 5000
WEB_LINK = re.compile(r"^https?://[^\s/]+\.[^\s/]+", re.IGNORECASE)


def _clean(v: str | None, high: int, what: str, *, lines: bool = False) -> str | None:
    if v is None:
        return None
    v = unicodedata.normalize("NFC", v).strip()
    if not v:
        return None
    if len(v) > high or any(unicodedata.category(c) in ("Cc", "Cf") and not (lines and c in "\n\r\t") for c in v):
        raise ValueError(f"{what}: at most {high} characters, without control characters")
    return v


class ClientIn(BaseModel):
    """The whole form (PATCH sends it all, as tasks do). `quote_id` (create only) links the quote that this client comes from."""

    model_config = ConfigDict(extra="forbid")

    name: str
    kinds: list[Kind] = Field(default_factory=lambda: ["other"], min_length=1, max_length=4)
    contact_name: str | None = None
    email: str | None = None
    phone: str | None = None
    address: str | None = None
    city: str | None = None
    notes: str | None = None
    quote_id: Annotated[int, Field(ge=1, le=MAX_ID)] | None = None

    @field_validator("kinds")
    @classmethod
    def _kinds(cls, v: list[str]) -> list[str]:
        return [k for k in KINDS if k in v]  # no repeats, always in the same order

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        out = _clean(v, 150, "name")
        if out is None:
            raise ValueError("the name is required")
        return out

    @field_validator("contact_name")
    @classmethod
    def _contact(cls, v: str | None) -> str | None:
        return _clean(v, 100, "contact_name")

    @field_validator("address")
    @classmethod
    def _address(cls, v: str | None) -> str | None:
        return _clean(v, 200, "address")

    @field_validator("city")
    @classmethod
    def _city(cls, v: str | None) -> str | None:
        return _clean(v, 60, "city")

    @field_validator("notes")
    @classmethod
    def _notes(cls, v: str | None) -> str | None:
        return _clean(v, NOTES_MAX, "notes", lines=True)

    @field_validator("email")
    @classmethod
    def _email(cls, v: str | None) -> str | None:
        return clean_email(v) if v and v.strip() else None

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str | None) -> str | None:
        if v is None or not v.strip():
            return None
        v = v.strip()
        if not PHONE_RE.match(v):
            raise ValueError("phone")
        return v


class PropertyIn(BaseModel):
    """The whole form (PATCH sends it all)."""

    model_config = ConfigDict(extra="forbid")

    name: str
    kind: Kind = "other"
    address: str | None = None
    city: str | None = None
    listing_url: str | None = None
    access_notes: str | None = None
    visit_price: Decimal | None = None
    photos_required: bool = False

    @field_validator("visit_price", mode="before")
    @classmethod
    def _price(cls, v: object) -> Decimal | None:
        return None if v is None else parse_amount(v)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        out = _clean(v, 100, "name")
        if out is None:
            raise ValueError("the name is required")
        return out

    @field_validator("address")
    @classmethod
    def _address(cls, v: str | None) -> str | None:
        return _clean(v, 200, "address")

    @field_validator("city")
    @classmethod
    def _city(cls, v: str | None) -> str | None:
        return _clean(v, 60, "city")

    @field_validator("access_notes")
    @classmethod
    def _notes(cls, v: str | None) -> str | None:
        return _clean(v, 2000, "access_notes", lines=True)

    @field_validator("listing_url")
    @classmethod
    def _listing(cls, v: str | None) -> str | None:
        out = _clean(v, 300, "listing_url")
        if out is not None and not WEB_LINK.match(out):  # only web links: it becomes a link people tap
            raise ValueError("listing_url")
        return out


class RoomIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: Annotated[int, Field(ge=1, le=MAX_ID)] | None = None
    name: str

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        out = _clean(v, 60, "name")
        if out is None:
            raise ValueError("the name is required")
        return out


class RoomsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rooms: list[RoomIn] = Field(max_length=30)
