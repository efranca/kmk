from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

from app.schedule.schemas import MAX_ID
from app.visits.limits import CHECKIN_PEOPLE_MAX, REASON_MAX


class CheckInIn(BaseModel):
    """Who is checked in: the person sending it and, on arrival, the colleagues with them."""

    model_config = ConfigDict(extra="forbid")

    people: list[Annotated[int, Field(ge=1, le=MAX_ID)]] = Field(min_length=1, max_length=CHECKIN_PEOPLE_MAX)


class CheckOutIn(BaseModel):
    """`confirm_no_photos`: the person saw the "no photos" warning and closes anyway."""

    model_config = ConfigDict(extra="forbid")

    confirm_no_photos: bool = False


class SkipIn(BaseModel):
    """A room left without photos, with the reason (trimmed and checked by the service)."""

    model_config = ConfigDict(extra="forbid")

    room_id: int = Field(ge=1, le=MAX_ID)
    reason: str = Field(max_length=REASON_MAX * 4)
