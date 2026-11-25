"""The public side of a quote request: a draft, its photos, and the Send that makes it a request."""

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import Request
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.auth import audit, ratelimit
from app.auth.errors import ApiError
from app.documents.files import detect_document
from app.models import Quote, QuotePhoto
from app.quotes import arrival, limits
from app.quotes.schemas import QuoteIn


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def start_draft(db: Session, data: QuoteIn, ip: str, geo: tuple[str | None, str | None], user_agent: str | None) -> tuple[Quote, str]:
    """Counts toward the hourly limit as soon as it starts (so unsent drafts cannot be used to fill the database)."""
    ratelimit.serialize(db, ip, "", kind="quote")
    now = _now()
    db.execute(delete(Quote).where(Quote.status == "draft", Quote.created_at < now - limits.DRAFT_TTL))  # photos cascade
    key = ratelimit.ip_key(ip)
    started = db.scalar(select(func.count()).select_from(Quote).where(Quote.ip_key == key, Quote.created_at >= now - timedelta(hours=1)))
    if started >= limits.MAX_PER_IP_PER_HOUR:
        raise ApiError(429, "rate_limited")
    token = secrets.token_urlsafe(32)
    quote = Quote(
        status="draft", kind=data.kind, name=data.name, email=data.email, phone=data.phone, locale=data.locale,
        details=data.details(), message=data.message, ip=ip, ip_key=key, geo_country=geo[0], geo_city=geo[1],
        user_agent=(user_agent or "")[:300] or None, token_hash=_hash(token),
    )
    db.add(quote)
    db.flush()
    return quote, token


def _find(db: Session, quote_id: int, token: str, *, lock: bool = False) -> Quote:
    """The quote this token belongs to, or 404. A draft must also be young enough."""
    stmt = select(Quote).where(Quote.id == quote_id)
    quote = db.scalar(stmt.with_for_update() if lock else stmt)
    if quote is None or not token or not hmac.compare_digest(quote.token_hash, _hash(token)):
        raise ApiError(404, "not_found")
    if quote.status == "draft" and quote.created_at < _now() - limits.DRAFT_TTL:
        raise ApiError(404, "not_found")
    return quote


def check_draft(db: Session, quote_id: int, token: str) -> None:
    if _find(db, quote_id, token).status != "draft":
        raise ApiError(404, "not_found")


def add_photo(db: Session, quote_id: int, token: str, data: bytes) -> QuotePhoto:
    quote = _find(db, quote_id, token, lock=True)
    if quote.status != "draft":
        raise ApiError(404, "not_found")
    content_type = detect_document(data, "photo")
    if content_type not in limits.PHOTO_TYPES:
        raise ApiError(422, "unsupported_type")
    if db.scalar(select(func.count()).select_from(QuotePhoto).where(QuotePhoto.quote_id == quote.id)) >= limits.MAX_PHOTOS:
        raise ApiError(422, "too_many_photos")
    pending = db.scalar(
        select(func.coalesce(func.sum(QuotePhoto.size), 0)).select_from(QuotePhoto).join(Quote, Quote.id == QuotePhoto.quote_id).where(Quote.status == "draft")
    )
    if pending + len(data) > limits.MAX_PENDING_PHOTO_BYTES:
        raise ApiError(503, "busy")
    photo = QuotePhoto(quote_id=quote.id, content_type=content_type, size=len(data), data=data)
    db.add(photo)
    db.flush()
    return photo


def submit(db: Session, quote_id: int, token: str) -> tuple[Quote, bool]:
    """Turns the draft into a request. Returns (quote, first_time); sending twice changes nothing the second time."""
    quote = _find(db, quote_id, token, lock=True)
    if quote.status != "draft":
        return quote, False
    now = _now()
    quote.status, quote.submitted_at, quote.deadline_at, quote.updated_at = "new", now, now + limits.DEADLINE, now
    audit.log(db, "quote_received", ip=quote.ip, details={"quote_id": quote.id})
    arrival.on_submitted(db, quote)
    db.flush()
    return quote, True

