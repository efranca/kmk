"""The personal calendar feed: a secret .ics link per user, for FamillAI, Google, Apple or Outlook to subscribe to.

Only the token's hash is stored; the link is shown once, when it is created. See docs/security.md.
"""

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.auth import audit
from app.auth.deps import get_db, get_settings_dep
from app.auth.guard import guard
from app.auth.routes import request_ip
from app.config import Settings
from app.models import CalendarFeed, User, UserSession
from app.security import hash_token, new_session_token

router = APIRouter()

FEED_PATH = "/api/schedule/feed/"


def feed_url(settings: Settings, raw: str) -> str:
    return f"{settings.public_base_url.rstrip('/')}{FEED_PATH}{raw}.ics"


def _iso(value) -> str | None:
    return value.isoformat() if value is not None else None


@router.get("/api/account/calendar-feed")
def read_feed(auth: tuple[User, UserSession] = Depends(guard(csrf=False)), db: Session = Depends(get_db)):
    feed = db.get(CalendarFeed, auth[0].id)
    if feed is None:
        return {"exists": False, "created_at": None, "last_used_at": None}
    return {"exists": True, "created_at": _iso(feed.created_at), "last_used_at": _iso(feed.last_used_at)}


@router.post("/api/account/calendar-feed", status_code=201)
def create_feed(
    request: Request,
    auth: tuple[User, UserSession] = Depends(guard()),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
):
    actor = auth[0]
    raw = new_session_token()
    db.execute(delete(CalendarFeed).where(CalendarFeed.user_id == actor.id))
    db.add(CalendarFeed(user_id=actor.id, token_hash=hash_token(raw)))
    db.flush()
    audit.log(db, "calendar_feed_created", actor_user_id=actor.id, ip=request_ip(request, settings))
    created_at = db.scalar(select(CalendarFeed.created_at).where(CalendarFeed.user_id == actor.id))
    db.commit()
    return {"url": feed_url(settings, raw), "created_at": _iso(created_at)}


@router.delete("/api/account/calendar-feed", status_code=204)
def revoke_feed(
    request: Request,
    auth: tuple[User, UserSession] = Depends(guard()),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
):
    actor = auth[0]
    removed = db.execute(delete(CalendarFeed).where(CalendarFeed.user_id == actor.id)).rowcount
    if removed:
        audit.log(db, "calendar_feed_revoked", actor_user_id=actor.id, ip=request_ip(request, settings))
    db.commit()
    return Response(status_code=204)
