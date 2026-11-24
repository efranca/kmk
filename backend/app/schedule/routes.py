from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.auth.deps import get_db, get_settings_dep
from app.auth.errors import ApiError
from app.auth.guard import guard
from app.auth.routes import request_ip
from app.config import Settings
from app.models import User, UserSession
from app.schedule import service
from app.schedule.schemas import EventIn

router = APIRouter(prefix="/api/schedule")

# Reading needs a verified session but no CSRF token (the same choice as the admin list).
reader = guard(csrf=False)


def _people_filter(raw: str | None) -> set[int] | None:
    if raw is None or not raw.strip():
        return None
    try:
        return {int(part) for part in raw.split(",") if part.strip()}
    except ValueError:
        raise ApiError(422, "invalid_people")


@router.get("/events")
def list_events(
    from_: date = Query(alias="from"),
    to: date = Query(),
    q: str | None = Query(default=None, max_length=100),
    people: str | None = Query(default=None, max_length=1000),
    auth: tuple[User, UserSession] = Depends(reader),
    db: Session = Depends(get_db),
):
    return {"occurrences": service.list_occurrences(db, from_, to, q, _people_filter(people))}


@router.get("/events/{event_id}")
def read_event(event_id: int, auth: tuple[User, UserSession] = Depends(reader), db: Session = Depends(get_db)):
    return {"event": service.event_payload(db, service.get_event(db, event_id))}


@router.post("/events", status_code=201)
def create_event(
    body: EventIn,
    request: Request,
    auth: tuple[User, UserSession] = Depends(guard()),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
):
    event = service.create_event(db, auth[0], body, request_ip(request, settings))
    payload = service.event_payload(db, event)
    db.commit()
    return {"event": payload}


@router.patch("/events/{event_id}")
def change_event(
    event_id: int,
    body: EventIn,
    request: Request,
    auth: tuple[User, UserSession] = Depends(guard()),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
):
    event = service.update_event(db, auth[0], event_id, body, request_ip(request, settings))
    payload = service.event_payload(db, event)
    db.commit()
    return {"event": payload}


@router.delete("/events/{event_id}")
def remove_event(
    event_id: int,
    request: Request,
    scope: Literal["this", "following", "all"] = "all",
    occurrence_date: date | None = None,
    auth: tuple[User, UserSession] = Depends(guard()),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
):
    service.delete_event(db, auth[0], event_id, scope, occurrence_date, request_ip(request, settings))
    db.commit()
    return {"status": "ok"}


@router.get("/people")
def list_people(auth: tuple[User, UserSession] = Depends(reader), db: Session = Depends(get_db)):
    return {"people": service.selectable_people(db)}
