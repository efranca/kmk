"""Request bodies of the invoices API."""

from datetime import date
from decimal import Decimal
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.clients.schemas import _clean
from app.invoices.money import parse_amount
from app.schedule.schemas import MAX_ID

MAX_LINES = 100
Id = Annotated[int, Field(ge=1, le=MAX_ID)]


class LineIn(BaseModel):
    """An Agenda line (`event_id` + the occurrence's original date) or a manual line (neither)."""

    model_config = ConfigDict(extra="forbid")

    event_id: Id | None = None
    occurrence_date: date | None = None
    description: str
    amount: Decimal

    @field_validator("description")
    @classmethod
    def _description(cls, v: str) -> str:
        out = _clean(v, 200, "description")
        if out is None:
            raise ValueError("the description is required")
        return out

    @field_validator("amount", mode="before")
    @classmethod
    def _amount(cls, v: object) -> Decimal:
        return parse_amount(v)

    @model_validator(mode="after")
    def _both_or_neither(self) -> "LineIn":
        if (self.event_id is None) != (self.occurrence_date is None):
            raise ValueError("event_id and occurrence_date go together")
        return self


class InvoiceIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    client_id: Id
    issued_on: date
    extra: Decimal = Decimal("0.00")
    lines: list[LineIn] = Field(min_length=1, max_length=MAX_LINES)

    @field_validator("extra", mode="before")
    @classmethod
    def _extra(cls, v: object) -> Decimal:
        return parse_amount(v)
