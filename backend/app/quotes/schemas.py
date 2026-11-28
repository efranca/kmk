"""The body of the public form."""

import re
from datetime import datetime
import unicodedata
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.auth.admin import clean_email
from app.quotes import limits

PHONE_RE = re.compile(r"^[0-9 +().\-]{7,30}$")
AIRBNB_PROPERTY = ("house", "apartment", "condo", "other")
COMMERCIAL_PROPERTY = ("office", "clinic", "shop", "restaurant", "industrial", "other")
POST_CONSTRUCTION_PROPERTY = ("house", "apartment", "condo", "office", "shop", "industrial", "other")
POST_CONSTRUCTION_FREQUENCY = ("once",)  # a one-time clean by definition
AIRBNB_FREQUENCY = ("once", "per_booking", "weekly", "biweekly", "monthly", "unsure")
COMMERCIAL_FREQUENCY = ("once", "weekly", "biweekly", "monthly", "post_construction", "unsure")


def _no_controls(v: str, *, allow_whitespace: bool = True) -> str:
    """Refuses control characters (a NUL cannot be stored and would be a server error). Line breaks and tabs may stay."""
    for c in v:
        if unicodedata.category(c) == "Cc" and not (allow_whitespace and c in "\n\r\t"):
            raise ValueError("invalid characters")
    return v


def _text(v: str, low: int, high: int, what: str) -> str:
    # Invisible format characters (a left-to-right mark pasted from a map) are dropped, not refused.
    v = "".join(c for c in unicodedata.normalize("NFC", v) if unicodedata.category(c) != "Cf").strip()
    if not low <= len(v) <= high:
        raise ValueError(f"{what}: {low} to {high} characters")
    return _no_controls(v, allow_whitespace=False)


class QuoteIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    email: str
    phone: str
    locale: Literal["fr-CA", "en-CA", "pt-BR"]
    kind: Literal["airbnb", "commercial", "post_construction"]
    city: str
    address: str
    property: str
    frequency: str
    bedrooms: int | None = Field(default=None, ge=0, le=20)
    bathrooms: float | None = Field(default=None, ge=0, le=20)
    area_sqft: int | None = Field(default=None, ge=1, le=1_000_000)
    message: str | None = None
    listing_url: str | None = None  # the Airbnb listing, optional
    website: str = ""  # the honeypot: people never see it

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        return _text(v, 1, 100, "name")

    @field_validator("city")
    @classmethod
    def _city(cls, v: str) -> str:
        return _text(v, 1, 60, "city")  # short on purpose: it is what tasks and notifications say

    @field_validator("address")
    @classmethod
    def _address(cls, v: str) -> str:
        return _text(v, 1, 200, "address")  # only admins ever read it

    @field_validator("listing_url")
    @classmethod
    def _listing_url(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = _text(v, 0, 300, "listing_url") if v.strip() else ""
        if not v:
            return None
        if not re.match(r"^https?://[^\s/]+\.[^\s/]+", v, re.IGNORECASE):  # only web links: it becomes a link for admins
            raise ValueError("listing_url")
        return v

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        return clean_email(v)

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str) -> str:
        v = v.strip()
        if not PHONE_RE.match(v):
            raise ValueError("phone")
        return v

    @field_validator("bathrooms")
    @classmethod
    def _halves(cls, v: float | None) -> float | None:
        if v is not None and (v * 2) % 1 != 0:
            raise ValueError("bathrooms come in steps of 0.5")
        return v

    @field_validator("message")
    @classmethod
    def _message(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = _no_controls(v.replace("\r\n", "\n").strip())
        if len(v) > limits.MAX_CHARS or len(v.split()) > limits.MAX_WORDS:
            raise ValueError("too_long")
        return v or None

    @model_validator(mode="after")
    def _per_kind(self) -> "QuoteIn":
        if self.listing_url and self.kind != "airbnb":
            raise ValueError("a listing link is for Airbnb")
        if self.kind == "airbnb":
            if self.property not in AIRBNB_PROPERTY or self.frequency not in AIRBNB_FREQUENCY:
                raise ValueError("property or frequency")
        elif self.kind == "post_construction":
            if self.property not in POST_CONSTRUCTION_PROPERTY or self.frequency not in POST_CONSTRUCTION_FREQUENCY:
                raise ValueError("property or frequency")
            if self.bedrooms is not None or self.bathrooms is not None:
                raise ValueError("bedrooms and bathrooms are for Airbnb")
        else:
            if self.property not in COMMERCIAL_PROPERTY or self.frequency not in COMMERCIAL_FREQUENCY:
                raise ValueError("property or frequency")
            if self.bedrooms is not None or self.bathrooms is not None:
                raise ValueError("bedrooms and bathrooms are for Airbnb")
            if not self.message:
                raise ValueError("message required")
        return self

    def details(self) -> dict:
        """The type-specific fields, as stored in `quotes.details`."""
        out = {"city": self.city, "address": self.address, "property": self.property, "frequency": self.frequency}
        for key in ("bedrooms", "bathrooms", "area_sqft"):
            if getattr(self, key) is not None:
                out[key] = getattr(self, key)
        if self.listing_url:
            out["listing_url"] = self.listing_url
        return out


class QuoteFieldsIn(BaseModel):
    """The data of a quote an admin writes down or completes by hand: only the name, phone and type are needed, the rest is as much as is known."""

    model_config = ConfigDict(extra="forbid")

    name: str
    phone: str
    email: str | None = None
    locale: Literal["fr-CA", "en-CA", "pt-BR"] = "fr-CA"  # the language to answer the customer in
    kind: Literal["airbnb", "commercial", "post_construction"]
    city: str = ""
    address: str = ""
    property: str | None = None
    frequency: str | None = None
    bedrooms: int | None = Field(default=None, ge=0, le=20)
    bathrooms: float | None = Field(default=None, ge=0, le=20)
    area_sqft: int | None = Field(default=None, ge=1, le=1_000_000)
    message: str | None = None
    listing_url: str | None = None

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        return _text(v, 1, 100, "name")

    @field_validator("city")
    @classmethod
    def _city(cls, v: str) -> str:
        return _text(v, 0, 60, "city") if v.strip() else ""

    @field_validator("address")
    @classmethod
    def _address(cls, v: str) -> str:
        return _text(v, 0, 200, "address") if v.strip() else ""

    @field_validator("email")
    @classmethod
    def _email(cls, v: str | None) -> str | None:
        return clean_email(v) if v and v.strip() else None

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str) -> str:
        v = v.strip()
        if not PHONE_RE.match(v):
            raise ValueError("phone")
        return v

    @field_validator("bathrooms")
    @classmethod
    def _halves(cls, v: float | None) -> float | None:
        if v is not None and (v * 2) % 1 != 0:
            raise ValueError("bathrooms come in steps of 0.5")
        return v

    @field_validator("message")
    @classmethod
    def _message(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = _no_controls(v.replace("\r\n", "\n").strip())
        if len(v) > limits.MAX_CHARS or len(v.split()) > limits.MAX_WORDS:
            raise ValueError("too_long")
        return v or None

    @field_validator("listing_url")
    @classmethod
    def _listing_url(cls, v: str | None) -> str | None:
        if v is None or not v.strip():
            return None
        v = _text(v, 1, 300, "listing_url")
        if not re.match(r"^https?://[^\s/]+\.[^\s/]+", v, re.IGNORECASE):
            raise ValueError("listing_url")
        return v

    @model_validator(mode="after")
    def _per_kind(self) -> "QuoteFieldsIn":
        allowed = {"airbnb": (AIRBNB_PROPERTY, AIRBNB_FREQUENCY), "commercial": (COMMERCIAL_PROPERTY, COMMERCIAL_FREQUENCY), "post_construction": (POST_CONSTRUCTION_PROPERTY, POST_CONSTRUCTION_FREQUENCY)}[self.kind]
        if self.property is not None and self.property not in allowed[0]:
            raise ValueError("property")
        if self.frequency is not None and self.frequency not in allowed[1]:
            raise ValueError("frequency")
        if self.kind != "airbnb" and (self.bedrooms is not None or self.bathrooms is not None or self.listing_url):
            raise ValueError("bedrooms, bathrooms and a listing link are for Airbnb")
        return self

    def details(self) -> dict:
        out = {"city": self.city, "address": self.address}
        for key in ("property", "frequency", "bedrooms", "bathrooms", "area_sqft", "listing_url"):
            if getattr(self, key) is not None:
                out[key] = getattr(self, key)
        return out


class ManualQuoteIn(QuoteFieldsIn):
    """A new quote entered by hand (a phone call, a visit): the same data, and the client it is for."""

    client_id: int | None = Field(default=None, ge=1, le=1_000_000_000_000)


class QuoteEditIn(QuoteFieldsIn):
    """The whole form again, to complete a saved quote. `message` is told apart omitted vs sent (`model_fields_set`);
    the linked client keeps its own control."""


STATUSES = ("new", "replied", "customer_replied", "won", "lost")
NOTE_MAX = 5000
BODY_MAX = 20_000


class QuotePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["new", "replied", "customer_replied", "won", "lost"] | None = None
    internal_note: str | None = Field(default=None, max_length=NOTE_MAX)
    client_id: int | None = Field(default=None, ge=1, le=1_000_000_000_000)  # null unlinks

    @field_validator("internal_note")
    @classmethod
    def _note(cls, v: str | None) -> str | None:
        return None if v is None else _no_controls(v)


class MessageIn(BaseModel):
    """`out` is emailed to the customer; `in` is a customer reply pasted from the team's mailbox."""

    model_config = ConfigDict(extra="forbid")

    direction: Literal["out", "in"]
    subject: str | None = Field(default=None, max_length=200)
    body: str = Field(min_length=1, max_length=BODY_MAX)
    sent_at: datetime | None = None

    @field_validator("body")
    @classmethod
    def _body(cls, v: str) -> str:
        v = _no_controls(v.replace("\r\n", "\n").strip())
        if not v:
            raise ValueError("empty")
        return v

    @model_validator(mode="after")
    def _per_direction(self) -> "MessageIn":
        if self.direction == "out":
            if not (self.subject and self.subject.strip()) or self.sent_at is not None:
                raise ValueError("a reply needs a subject and no date")
            self.subject = _no_controls(self.subject.strip(), allow_whitespace=False)  # no line break: it is an email header
        elif self.subject is not None:
            raise ValueError("a pasted reply has no subject")
        return self
