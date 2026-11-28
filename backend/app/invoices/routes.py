from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query
from sqlalchemy.orm import Session

from app.auth import policy
from app.auth.deps import get_db
from app.auth.errors import ApiError
from app.auth.guard import guard
from app.clients import service as clients
from app.invoices import billing
from app.models import User, UserSession
from app.schedule.recurrence import MAX_RANGE_DAYS
from app.schedule.schemas import MAX_ID

router = APIRouter(prefix="/api")
ClientId = Annotated[int, Path(ge=1, le=MAX_ID)]


@router.get("/clients/{client_id}/billable")
def list_billable(
    client_id: ClientId,
    from_: Annotated[date, Query(alias="from")],
    to: date,
    auth: tuple[User, UserSession] = Depends(guard(csrf=False)),
    db: Session = Depends(get_db),
):
    policy.check_invoices(auth[0])
    clients.get_client(db, auth[0], client_id)
    if to < from_ or (to - from_).days + 1 > MAX_RANGE_DAYS:
        raise ApiError(422, "bad_range")
    return {"occurrences": billing.billable(db, client_id, from_, to, billing.company_today())}
