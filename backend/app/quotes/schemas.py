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
AIRBNB_FREQUENCY = ("once", "per_booking", "weekly", "biweekly", "monthly", "unsure")
COMMERCIAL_FREQUENCY = ("once", "weekly", "biweekly", "monthly", "post_construction", "unsure")


def _text(v: str, low: int, high: int, what: str) -> str:
    v = unicodedata.normalize("NFC", v).strip()
    if not low <= len(v) <= high or any(unicodedata.category(c) in ("Cc", "Cf") for c in v):
        raise ValueError(f"{what}: {low} to {high} characters, no control characters")
    return v


class QuoteIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    email: str
    phone: str
    locale: Literal["fr-CA", "en-CA", "pt-BR"]
    kind: Literal["airbnb", "commercial"]
    city: str
    property: str
    frequency: str
    bedrooms: int | None = Field(default=None, ge=0, le=20)
    bathrooms: float | None = Field(default=None, ge=0, le=20)
    area_sqft: int | None = Field(default=None, ge=1, le=1_000_000)
    message: str | None = None
    website: str = ""  # the honeypot: people never see it

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        return _text(v, 1, 100, "name")

    @field_validator("city")
    @classmethod
    def _city(cls, v: str) -> str:
        return _text(v, 1, 200, "address")

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
        v = v.replace("\r\n", "\n").strip()
        if len(v) > limits.MAX_CHARS or len(v.split()) > limits.MAX_WORDS:
            raise ValueError("too_long")
        return v or None

    @model_validator(mode="after")
    def _per_kind(self) -> "QuoteIn":
        if self.kind == "airbnb":
            if self.property not in AIRBNB_PROPERTY or self.frequency not in AIRBNB_FREQUENCY:
                raise ValueError("property or frequency")
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
        out = {"city": self.city, "property": self.property, "frequency": self.frequency}
        for key in ("bedrooms", "bathrooms", "area_sqft"):
            if getattr(self, key) is not None:
                out[key] = getattr(self, key)
        return out


STATUSES = ("new", "replied", "customer_replied", "won", "lost")
NOTE_MAX = 5000
BODY_MAX = 20_000


class QuotePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["new", "replied", "customer_replied", "won", "lost"] | None = None
    internal_note: str | None = Field(default=None, max_length=NOTE_MAX)


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
        v = v.replace("\r\n", "\n").strip()
        if not v:
            raise ValueError("empty")
        return v

    @model_validator(mode="after")
    def _per_direction(self) -> "MessageIn":
        if self.direction == "out":
            if not (self.subject and self.subject.strip()) or self.sent_at is not None:
                raise ValueError("a reply needs a subject and no date")
            self.subject = self.subject.strip()
        elif self.subject is not None:
            raise ValueError("a pasted reply has no subject")
        return self
