"""The open quote form's API: no sign-in. Protected by the hourly limit per IP, a one-time token per draft, and caps."""

from fastapi import APIRouter, BackgroundTasks, Depends, Request
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app import system_settings
from app.auth import geo
from app.auth.deps import get_db, get_settings_dep
from app.auth.errors import ApiError
from app.auth.routes import request_ip
from app.config import Settings
from app.documents import uploads
from app.quotes import arrival, intake, limits
from app.quotes.schemas import QuoteIn

router = APIRouter(prefix="/api/public/quotes")


def _token(request: Request) -> str:
    return request.headers.get("x-quote-token", "")


@router.get("/config")
def public_config(db: Session = Depends(get_db)):
    return {"phone": system_settings.get(db, "public_phone")}


@router.post("", status_code=201)
async def start_quote(request: Request, db: Session = Depends(get_db), settings: Settings = Depends(get_settings_dep)):
    try:
        raw = await request.json()
    except ValueError:
        raise ApiError(422, "invalid")
    if not isinstance(raw, dict):
        raise ApiError(422, "invalid")
    if str(raw.get("website") or "").strip():  # the honeypot: look successful, store nothing
        return {"id": 0, "token": "x"}
    try:
        data = QuoteIn.model_validate(raw)
    except ValidationError as exc:
        too_long = any("too_long" in str(e.get("msg", "")) for e in exc.errors())
        raise ApiError(422, "too_long" if too_long else "invalid")
    ip = request_ip(request, settings)
    quote, token = intake.start_draft(db, data, ip, geo.from_request(request, settings), request.headers.get("user-agent"))
    quote_id = quote.id
    db.commit()
    return {"id": quote_id, "token": token}


@router.put("/{quote_id}/photos", status_code=201)
async def upload_photo(quote_id: int, request: Request, db: Session = Depends(get_db)):
    token = _token(request)
    intake.check_draft(db, quote_id, token)  # 404 before reading anything
    db.rollback()  # do not hold a database connection while the photo streams in
    uploads.slots.acquire()
    try:
        data = await uploads.read_capped(request, limits.MAX_PHOTO_BYTES)
    finally:
        uploads.slots.release()
    photo = intake.add_photo(db, quote_id, token, data)
    payload = {"id": photo.id, "size": photo.size, "content_type": photo.content_type}
    db.commit()
    return {"photo": payload}


@router.post("/{quote_id}/submit")
def submit_quote(
    quote_id: int,
    request: Request,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
):
    if quote_id == 0:  # the honeypot's pretend request
        return {"reference": "D-0000"}
    quote, first_time = intake.submit(db, quote_id, _token(request))
    reference = quote.reference
    db.commit()
    if first_time:
        background.add_task(arrival.notify, request.app.state.engine, settings, quote_id)
    return {"reference": reference}
