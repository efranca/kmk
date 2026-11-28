from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

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
    """A room left without photos, with the reason (trimmed and checked by the service). After the visit is closed the
    skip is a correction and also needs `correction_reason` (why it is done after the fact; `reason` is why the room was
    skipped)."""

    model_config = ConfigDict(extra="forbid")

    room_id: int = Field(ge=1, le=MAX_ID)
    reason: str = Field(max_length=REASON_MAX * 4)
    correction_reason: str | None = Field(default=None, max_length=REASON_MAX * 4)


class PhotoRemoveIn(BaseModel):
    """The optional body of a photo removal: after the visit is closed it is a correction and needs a `reason`."""

    model_config = ConfigDict(extra="forbid")

    reason: str | None = Field(default=None, max_length=REASON_MAX * 4)


class CorrectionIn(BaseModel):
    """A correction of a visit after the fact (spec section 10). `user_id` names the person for `withdraw` and
    `add_person` and is refused for the others."""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["close", "withdraw", "add_person", "reopen"]
    reason: str = Field(max_length=REASON_MAX * 4)
    user_id: Annotated[int, Field(ge=1, le=MAX_ID)] | None = None

    @field_validator("reason")
    @classmethod
    def _reason(cls, v: str) -> str:
        v = v.strip()
        if not 1 <= len(v) <= REASON_MAX:
            raise ValueError(f"reason: 1 to {REASON_MAX} characters")
        return v

    @model_validator(mode="after")
    def _person(self) -> "CorrectionIn":
        about_someone = self.kind in ("withdraw", "add_person")
        if about_someone and self.user_id is None:
            raise ValueError("user_id is required for this correction")
        if not about_someone and self.user_id is not None:
            raise ValueError("user_id is only for withdraw and add_person")
        return self
