"""The internal side of quotes: reading them, the conversation, and what a message changes (status, task, Agenda item)."""

from datetime import datetime, timedelta, timezone

from fastapi import Response
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app import system_settings
from app.clients.service import check_client
from app.auth import audit
from app.auth.errors import ApiError
from app.config import Settings
from app.emails import sender
from app.models import Client, Event, Quote, QuoteMessage, QuotePhoto, Task, User
from app.quotes import emails
from app.quotes.schemas import MessageIn, QuotePatch
from app.schedule.service import display_name

CLOCK_SKEW = timedelta(minutes=2)


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def _now() -> datetime:
    return datetime.now(timezone.utc)


def get_quote(db: Session, quote_id: int, *, lock: bool = False) -> Quote:
    stmt = select(Quote).where(Quote.id == quote_id, Quote.status != "draft")
    quote = db.scalar(stmt.with_for_update() if lock else stmt)
    if quote is None:
        raise ApiError(404, "not_found")
    return quote


def _summary(quote: Quote, messages: int) -> dict:
    return {
        "id": quote.id, "reference": quote.reference, "status": quote.status, "kind": quote.kind, "name": quote.name,
        "email": quote.email, "phone": quote.phone, "city": (quote.details or {}).get("city", ""), "submitted_at": _iso(quote.submitted_at), "deadline_at": _iso(quote.deadline_at),
        "overdue": quote.status == "new" and quote.deadline_at is not None and quote.deadline_at < _now(), "messages": messages,
    }


def list_quotes(db: Session, status: str) -> dict:
    query = select(Quote, select(func.count()).select_from(QuoteMessage).where(QuoteMessage.quote_id == Quote.id).scalar_subquery()).where(Quote.status != "draft")
    if status != "all":
        query = query.where(Quote.status == status)
    rows = db.execute(query.order_by(Quote.submitted_at.desc(), Quote.id.desc())).all()
    counts = dict(db.execute(select(Quote.status, func.count()).where(Quote.status.in_(("new", "customer_replied", "replied"))).group_by(Quote.status)).all())
    return {
        "quotes": [_summary(q, n) for q, n in rows],
        "counts": {"new": counts.get("new", 0), "customer_replied": counts.get("customer_replied", 0), "replied": counts.get("replied", 0)},
    }


def _message_payload(m: QuoteMessage, authors: dict[int, User]) -> dict:
    author = authors.get(m.author_id) if m.author_id else None
    return {
        "id": m.id, "direction": m.direction, "subject": m.subject, "body": m.body, "sent_at": _iso(m.sent_at), "delivery": m.delivery,
        "author": {"id": author.id, "name": display_name(author)} if author else None,
    }


def _client_ref(db: Session, client_id: int | None) -> dict | None:
    client = db.get(Client, client_id) if client_id is not None else None
    return {"id": client.id, "name": client.name} if client else None


def quote_payload(db: Session, quote: Quote) -> dict:
    messages = list(db.scalars(select(QuoteMessage).where(QuoteMessage.quote_id == quote.id).order_by(QuoteMessage.sent_at, QuoteMessage.id)))
    ids = {m.author_id for m in messages if m.author_id}
    authors = {u.id: u for u in db.scalars(select(User).where(User.id.in_(ids)))} if ids else {}
    photos = db.execute(select(QuotePhoto.id, QuotePhoto.content_type, QuotePhoto.size).where(QuotePhoto.quote_id == quote.id).order_by(QuotePhoto.id)).all()
    return {
        **_summary(quote, len(messages)),
        "locale": quote.locale, "details": quote.details, "message": quote.message,
        "internal_note": quote.internal_note, "ip": quote.ip, "geo_country": quote.geo_country, "geo_city": quote.geo_city,
        "client": _client_ref(db, quote.client_id), "user_agent": quote.user_agent, "task_id": quote.task_id, "event_id": quote.event_id, "first_reply_at": _iso(quote.first_reply_at),
        "photos": [{"id": i, "content_type": t, "size": s} for i, t, s in photos],
        "conversation": [_message_payload(m, authors) for m in messages],
        "default_subject": emails.default_subject(quote),
    }


def photo_response(db: Session, quote_id: int, photo_id: int) -> Response:
    get_quote(db, quote_id)
    photo = db.scalar(select(QuotePhoto).where(QuotePhoto.id == photo_id, QuotePhoto.quote_id == quote_id))
    if photo is None:
        raise ApiError(404, "not_found")
    heic = photo.content_type == "image/heic"  # browsers cannot show it: a download
    disposition = f'attachment; filename="D-{quote_id:04d}-{photo.id}.heic"' if heic else "inline"
    return Response(
        content=photo.data, media_type=photo.content_type,
        headers={"Content-Disposition": disposition, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=3600"},
    )


def update_quote(db: Session, actor: User, quote_id: int, data: QuotePatch, ip: str) -> Quote:
    quote = get_quote(db, quote_id, lock=True)
    if data.status is not None and data.status != quote.status:
        audit.log(db, "quote_status_changed", actor_user_id=actor.id, ip=ip, details={"quote_id": quote.id, "from": quote.status, "to": data.status})
        quote.status = data.status
    if "client_id" in data.model_fields_set:
        check_client(db, data.client_id)
        quote.client_id = data.client_id
    if data.internal_note is not None:
        quote.internal_note = data.internal_note.strip() or None
    quote.updated_at = _now()
    db.flush()
    return quote


def _apply_reply_rules(db: Session, quote: Quote, message: QuoteMessage, actor: User) -> None:
    """Status follows the conversation. Won and Lost are only ever set by hand."""
    if message.direction == "out" and message.delivery == "sent":
        if quote.first_reply_at is None:  # the 24-hour deadline is met: close the task, drop the Agenda item
            quote.first_reply_at = _now()
            if quote.task_id is not None:
                task = db.get(Task, quote.task_id)
                if task is not None and task.status != "completed":
                    task.status, task.completed_at, task.completed_by = "completed", _now(), actor.id
                    task.updated_by, task.updated_at = actor.id, _now()
            if quote.event_id is not None:
                db.execute(delete(Event).where(Event.id == quote.event_id))
                quote.event_id = None
        if quote.status in ("new", "customer_replied"):
            quote.status = "replied"
    elif message.direction == "in" and quote.status in ("new", "replied"):
        quote.status = "customer_replied"
    quote.updated_at = _now()


def _send(db: Session, quote: Quote, subject: str, body: str, settings: Settings) -> str:
    """Emails the customer now. Returns "sent" or "failed" (a provider error never escapes)."""
    sender_address = system_settings.get(db, "quote_from")
    if not sender_address:
        raise ApiError(409, "sender_not_configured")
    reply_to = system_settings.get(db, "quote_reply_to") or None
    email = emails.customer_reply(quote, subject, body, sender_address, reply_to)
    try:
        return "sent" if sender.send_email(email, settings) else "failed"
    except Exception:
        return "failed"


def add_message(db: Session, actor: User, quote_id: int, data: MessageIn, settings: Settings, ip: str) -> tuple[Quote, QuoteMessage]:
    quote = get_quote(db, quote_id, lock=True)
    now = _now()
    if data.direction == "out":
        delivery = _send(db, quote, data.subject or "", data.body, settings)
        message = QuoteMessage(quote_id=quote.id, direction="out", subject=data.subject, body=data.body, author_id=actor.id, sent_at=now, delivery=delivery)
        db.add(message)
        action = "quote_reply_sent"
    else:
        sent_at = data.sent_at or now
        if sent_at.tzinfo is None:
            sent_at = sent_at.replace(tzinfo=timezone.utc)
        if sent_at > now + CLOCK_SKEW:
            raise ApiError(422, "invalid")
        message = QuoteMessage(quote_id=quote.id, direction="in", body=data.body, author_id=actor.id, sent_at=sent_at)
        db.add(message)
        action = "quote_reply_pasted"
    db.flush()
    _apply_reply_rules(db, quote, message, actor)
    audit.log(db, action, actor_user_id=actor.id, ip=ip, details={"quote_id": quote.id, "message_id": message.id, "delivery": message.delivery})
    db.flush()
    return quote, message


def retry_message(db: Session, actor: User, quote_id: int, message_id: int, settings: Settings, ip: str) -> tuple[Quote, QuoteMessage]:
    quote = get_quote(db, quote_id, lock=True)
    message = db.scalar(select(QuoteMessage).where(QuoteMessage.id == message_id, QuoteMessage.quote_id == quote.id).with_for_update())
    if message is None:
        raise ApiError(404, "not_found")
    if message.direction != "out" or message.delivery != "failed":
        raise ApiError(409, "invalid_state")
    message.delivery = _send(db, quote, message.subject or "", message.body, settings)
    _apply_reply_rules(db, quote, message, actor)
    audit.log(db, "quote_reply_sent", actor_user_id=actor.id, ip=ip, details={"quote_id": quote.id, "message_id": message.id, "delivery": message.delivery, "retry": True})
    db.flush()
    return quote, message


def delete_quote(db: Session, actor: User, quote_id: int, ip: str) -> None:
    quote = get_quote(db, quote_id, lock=True)
    audit.log(db, "quote_deleted", actor_user_id=actor.id, ip=ip, details={"quote_id": quote.id, "reference": quote.reference})
    db.delete(quote)  # photos and messages go with it (ON DELETE CASCADE); the task and the Agenda item stay
    db.flush()
