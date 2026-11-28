from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, Path, Query, Request, Response
from sqlalchemy.orm import Session

from app.auth.deps import get_db, get_settings_dep
from app.auth.errors import ApiError
from app.auth.guard import guard
from app.auth.routes import request_ip
from app.config import Settings
from app.models import User, UserSession
from app.emails import sender
from app.schedule import notices, service
from app.schedule.schemas import MAX_ID, DismissIn, EventIn

router = APIRouter(prefix="/api/schedule")

# Reading needs a verified session but no CSRF token (the same choice as the admin list).
reader = guard(csrf=False)


def _people_filter(raw: str | None) -> set[int] | None:
    if raw is None or not raw.strip():
        return None
    try:
        ids = {int(part) for part in raw.split(",") if part.strip()}
        if any(not 1 <= i <= MAX_ID for i in ids):
            raise ValueError
        return ids
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
    return {"occurrences": service.list_occurrences(db, auth[0], from_, to, q, _people_filter(people))}


@router.get("/events/{event_id}")
def read_event(event_id: Annotated[int, Path(ge=1, le=MAX_ID)], auth: tuple[User, UserSession] = Depends(reader), db: Session = Depends(get_db)):
    return {"event": service.event_payload(db, service.get_event(db, event_id, auth[0]), auth[0])}


def _send(background: BackgroundTasks, request: Request, settings: Settings, mail: list) -> None:
    for message, user_id in mail:
        background.add_task(sender.deliver, request.app.state.engine, settings, message, user_id)


@router.post("/events", status_code=201)
def create_event(
    body: EventIn,
    request: Request,
    background: BackgroundTasks,
    auth: tuple[User, UserSession] = Depends(guard()),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
):
    event = service.create_event(db, auth[0], body, request_ip(request, settings))
    payload = service.event_payload(db, event, auth[0])
    mail = notices.assignment_emails(db, event, set(payload["people"]), auth[0], settings.public_base_url)
    db.commit()
    _send(background, request, settings, mail)
    return {"event": payload}


@router.patch("/events/{event_id}")
def change_event(
    event_id: Annotated[int, Path(ge=1, le=MAX_ID)],
    body: EventIn,
    request: Request,
    background: BackgroundTasks,
    auth: tuple[User, UserSession] = Depends(guard()),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
):
    before = set(service.event_payload(db, service.get_event(db, event_id, auth[0]), auth[0])["people"])
    event = service.update_event(db, auth[0], event_id, body, request_ip(request, settings))
    payload = service.event_payload(db, event, auth[0])
    mail = notices.assignment_emails(db, event, set(payload["people"]) - before, auth[0], settings.public_base_url)
    db.commit()
    _send(background, request, settings, mail)
    return {"event": payload}


@router.delete("/events/{event_id}")
def remove_event(
    event_id: Annotated[int, Path(ge=1, le=MAX_ID)],
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


@router.get("/reminders/due")
def due_reminders(auth: tuple[User, UserSession] = Depends(reader), db: Session = Depends(get_db)):
    return {"reminders": service.due_reminders(db, auth[0])}


@router.post("/reminders/dismiss", status_code=204)
def dismiss_reminder(body: DismissIn, auth: tuple[User, UserSession] = Depends(guard()), db: Session = Depends(get_db)):
    service.dismiss_reminder(db, auth[0], body.event_id, body.occurrence_date)
    db.commit()
    return Response(status_code=204)
