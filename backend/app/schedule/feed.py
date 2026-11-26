"""The personal calendar feed: a secret .ics link per user, for FamillAI, Google, Apple or Outlook to subscribe to.

Only the token's hash is stored; the link is shown once, when it is created. See docs/security.md.
"""

import logging
import re
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.auth import audit, ratelimit
from app.auth.deps import get_db, get_settings_dep
from app.auth.errors import ApiError
from app.auth.guard import guard
from app.auth.routes import request_ip
from app.config import Settings
from app.models import CalendarFeed, User, UserSession
from app.schedule import service
from app.schedule.ics import render_feed
from app.security import hash_token, new_session_token

router = APIRouter()

FEED_PATH = "/api/schedule/feed/"
SUFFIX = ".ics"
DAYS_BACK, DAYS_AHEAD = 31, 365
RATE_KIND = "feed"


_FEED_IN_PATH = re.compile(r"(/api/schedule/feed/)[^/?\s]*")


class FeedPathRedactor(logging.Filter):
    """Keeps the secret out of uvicorn's access log: the feed path is logged as /api/schedule/feed/[redacted]."""

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, tuple) and any(isinstance(a, str) and FEED_PATH in a for a in record.args):
            record.args = tuple(_FEED_IN_PATH.sub(r"\1[redacted]", a) if isinstance(a, str) else a for a in record.args)
        return True


def install_log_redaction() -> None:
    logger = logging.getLogger("uvicorn.access")
    if not any(isinstance(f, FeedPathRedactor) for f in logger.filters):
        logger.addFilter(FeedPathRedactor())


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


@router.get(FEED_PATH + "{name}")
def read_calendar(
    name: str,
    request: Request,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
):
    """Public: the secret in the link is the only credential. Every failure looks the same (404).

    A valid link is served whatever the address's count of failures: FamillAI and Google fetch every subscription
    from shared addresses, and stale links there must not lock out the valid ones (the tokens are 256-bit, so the
    limit is only a brake on noise). Failed lookups are serialized, rate-limited and recorded per address."""
    raw = name[: -len(SUFFIX)] if name.endswith(SUFFIX) else ""
    digest = hash_token(raw)
    feed = None
    if raw:
        feed = db.scalar(
            select(CalendarFeed)
            .join(User, User.id == CalendarFeed.user_id)
            .where(CalendarFeed.token_hash == digest, User.status == "active")
        )
    if feed is None:
        ip = request_ip(request, settings)
        identifier = digest[:16]
        ratelimit.serialize(db, ip, identifier, RATE_KIND)
        if ratelimit.is_limited(db, ip, identifier, settings, kind=RATE_KIND):
            raise ApiError(429, "too_many_attempts")
        ratelimit.record_attempt(db, ip, identifier, False, kind=RATE_KIND)
        db.commit()
        raise ApiError(404, "not_found")

    today = service.now_toronto().date()
    occurrences = service.assigned_occurrences(db, feed.user_id, today - timedelta(days=DAYS_BACK), today + timedelta(days=DAYS_AHEAD))
    feed.last_used_at = func.now()
    db.commit()
    body = render_feed(occurrences, datetime.now(timezone.utc))
    return Response(body, media_type="text/calendar; charset=utf-8", headers={"Cache-Control": "private, no-store"})
