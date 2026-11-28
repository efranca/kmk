"""`/api/visits`: the visits of today, one visit, check-in and check-out.

Static paths (`/today`, and later the report) are registered before the `/{event_id}/{occurrence_date}` routes: FastAPI
tries routes in order, and the parametrized one would answer 422 for them otherwise.
"""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Request
from sqlalchemy.orm import Session

from app.auth.deps import get_db, get_settings_dep
from app.auth.guard import guard
from app.auth.routes import request_ip
from app.config import Settings
from app.models import User, UserSession
from app.schedule.schemas import MAX_ID
from app.visits import service
from app.visits.schemas import CheckInIn, CheckOutIn

router = APIRouter(prefix="/api/visits")
EventId = Annotated[int, Path(ge=1, le=MAX_ID)]


# ---- static paths first -----------------------------------------------------------------------------------------


@router.get("/today")
def visits_today(auth: tuple[User, UserSession] = Depends(guard(csrf=False)), db: Session = Depends(get_db)):
    return {"visits": service.today(db, auth[0], service.now())}


# ---- one visit --------------------------------------------------------------------------------------------------


@router.get("/{event_id}/{occurrence_date}")
def read_visit(event_id: EventId, occurrence_date: date, auth: tuple[User, UserSession] = Depends(guard(csrf=False)), db: Session = Depends(get_db)):
    return {"visit": service.get_visit(db, auth[0], event_id, occurrence_date)}


@router.post("/{event_id}/{occurrence_date}/checkin")
def check_in(event_id: EventId, occurrence_date: date, body: CheckInIn, request: Request, auth: tuple[User, UserSession] = Depends(guard()), db: Session = Depends(get_db), settings: Settings = Depends(get_settings_dep)):
    payload = service.check_in(db, auth[0], event_id, occurrence_date, body.people, service.now(), request_ip(request, settings))
    db.commit()
    return {"visit": payload}


@router.post("/{event_id}/{occurrence_date}/checkout")
def check_out(event_id: EventId, occurrence_date: date, body: CheckOutIn, request: Request, auth: tuple[User, UserSession] = Depends(guard()), db: Session = Depends(get_db), settings: Settings = Depends(get_settings_dep)):
    payload = service.check_out(db, auth[0], event_id, occurrence_date, body.confirm_no_photos, service.now(), request_ip(request, settings))
    db.commit()
    return {"visit": payload}
