"""`/api/visits`: the visits of today, one visit, check-in and check-out.

Static paths (`/today`, and later the report) are registered before the `/{event_id}/{occurrence_date}` routes: FastAPI
tries routes in order, and the parametrized one would answer 422 for them otherwise.
"""

import asyncio
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.auth.deps import get_db, get_settings_dep
from app.auth.guard import guard
from app.auth.routes import request_ip
from app.config import Settings
from app.models import User, UserSession
from app.schedule.schemas import MAX_ID
from app.auth.errors import ApiError
from app.documents import uploads
from app.visits import photos, service
from app.visits.limits import MAX_PHOTO_BYTES, ROOM_NAME_MAX
from app.visits.schemas import CheckInIn, CheckOutIn, SkipIn

PHOTO_READ_SECONDS = 60  # a photo that takes longer than this to arrive is dropped

router = APIRouter(prefix="/api/visits")
photo_router = APIRouter(prefix="/api/visit-photos")
EventId = Annotated[int, Path(ge=1, le=MAX_ID)]
PhotoId = Annotated[int, Path(ge=1, le=MAX_ID)]


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


# ---- photos and room skips --------------------------------------------------------------------------------------


def _before_body(db: Session, settings: Settings, actor: User, event_id: int, occurrence_date: date, room_id: int | None, other_name: str | None) -> None:
    photos.precheck(db, actor, event_id, occurrence_date, room_id, other_name)  # 404 / 403 / 409 / 422 before reading anything
    photos.ensure_space(settings)  # and 503 before the body is read
    db.rollback()  # do not hold a database connection open while the photo streams in


@router.put("/{event_id}/{occurrence_date}/photos", status_code=201)
async def put_photo(
    event_id: EventId,
    occurrence_date: date,
    request: Request,
    room_id: Annotated[int | None, Query(ge=1, le=MAX_ID)] = None,
    other_name: Annotated[str | None, Query(max_length=ROOM_NAME_MAX * 4)] = None,
    auth: tuple[User, UserSession] = Depends(guard()),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
):
    actor = auth[0]
    # Everything that touches the database or the disk runs in the thread pool: waiting for the visit's row lock on the
    # event loop would freeze every request, and the lock may be released only by work that needs the loop.
    await run_in_threadpool(_before_body, db, settings, actor, event_id, occurrence_date, room_id, other_name)
    photos.slots.acquire()
    try:
        try:
            async with asyncio.timeout(PHOTO_READ_SECONDS):  # a trickle that never ends must not hold the slot
                data = await uploads.read_capped(request, MAX_PHOTO_BYTES, "photo_too_large")
        except TimeoutError:
            raise ApiError(408, "timeout")
        # The decode runs while the slot is still held, so at most two pictures are decoded at once.
        content_type = await run_in_threadpool(photos.validate, data)
    finally:
        photos.slots.release()
    ip = request_ip(request, settings)
    payload = await run_in_threadpool(photos.add, db, settings, actor, event_id, occurrence_date, data, content_type, room_id, other_name, service.now(), ip)
    return {"visit": payload}


@router.post("/{event_id}/{occurrence_date}/skips", status_code=201)
def post_skip(event_id: EventId, occurrence_date: date, body: SkipIn, request: Request, auth: tuple[User, UserSession] = Depends(guard()), db: Session = Depends(get_db), settings: Settings = Depends(get_settings_dep)):
    payload = photos.skip(db, auth[0], event_id, occurrence_date, body.room_id, body.reason, service.now(), request_ip(request, settings))
    return {"visit": payload}


@photo_router.get("/{photo_id}")
def get_photo(photo_id: PhotoId, auth: tuple[User, UserSession] = Depends(guard(csrf=False)), db: Session = Depends(get_db), settings: Settings = Depends(get_settings_dep)):
    photo, data = photos.read(db, settings, auth[0], photo_id)
    return Response(
        content=data,
        media_type=photo.content_type,
        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"},
    )


@photo_router.delete("/{photo_id}")
def delete_photo(photo_id: PhotoId, request: Request, auth: tuple[User, UserSession] = Depends(guard()), db: Session = Depends(get_db), settings: Settings = Depends(get_settings_dep)):
    return {"visit": photos.remove(db, settings, auth[0], photo_id, service.now(), request_ip(request, settings))}
