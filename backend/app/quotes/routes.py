"""The Quotes area for admins and the super admin."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Path, Query, Request, Response
from sqlalchemy.orm import Session

from app.auth import policy
from app.auth.deps import get_db, get_settings_dep
from app.auth.guard import guard
from app.auth.routes import request_ip
from app.config import Settings
from app.models import User, UserSession
from app.quotes import service
from app.quotes.schemas import MessageIn, QuotePatch
from app.schedule.schemas import MAX_ID

router = APIRouter(prefix="/api/quotes")
reader = guard(csrf=False)

QuoteId = Annotated[int, Path(ge=1, le=MAX_ID)]
ItemId = Annotated[int, Path(ge=1, le=MAX_ID)]
Status = Literal["all", "new", "replied", "customer_replied", "won", "lost"]


@router.get("")
def list_quotes(status: Annotated[Status, Query()] = "all", auth: tuple[User, UserSession] = Depends(reader), db: Session = Depends(get_db)):
    policy.check_quotes(auth[0])
    return service.list_quotes(db, status)


@router.get("/{quote_id}")
def read_quote(quote_id: QuoteId, auth: tuple[User, UserSession] = Depends(reader), db: Session = Depends(get_db)):
    policy.check_quotes(auth[0])
    return {"quote": service.quote_payload(db, service.get_quote(db, quote_id))}


@router.get("/{quote_id}/photos/{photo_id}")
def read_photo(quote_id: QuoteId, photo_id: ItemId, auth: tuple[User, UserSession] = Depends(reader), db: Session = Depends(get_db)):
    policy.check_quotes(auth[0])
    return service.photo_response(db, quote_id, photo_id)


@router.patch("/{quote_id}")
def change_quote(
    quote_id: QuoteId,
    body: QuotePatch,
    request: Request,
    auth: tuple[User, UserSession] = Depends(guard()),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
):
    policy.check_quotes(auth[0])
    quote = service.update_quote(db, auth[0], quote_id, body, request_ip(request, settings))
    payload = service.quote_payload(db, quote)
    db.commit()
    return {"quote": payload}


@router.post("/{quote_id}/messages", status_code=201)
def add_message(
    quote_id: QuoteId,
    body: MessageIn,
    request: Request,
    auth: tuple[User, UserSession] = Depends(guard()),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
):
    policy.check_quotes(auth[0])
    quote, message = service.add_message(db, auth[0], quote_id, body, settings, request_ip(request, settings))
    payload = service.quote_payload(db, quote)
    db.commit()
    return {"message": next(m for m in payload["conversation"] if m["id"] == message.id), "quote": payload}


@router.post("/{quote_id}/messages/{message_id}/retry")
def retry_message(
    quote_id: QuoteId,
    message_id: ItemId,
    request: Request,
    auth: tuple[User, UserSession] = Depends(guard()),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
):
    policy.check_quotes(auth[0])
    quote, message = service.retry_message(db, auth[0], quote_id, message_id, settings, request_ip(request, settings))
    payload = service.quote_payload(db, quote)
    db.commit()
    return {"message": next(m for m in payload["conversation"] if m["id"] == message.id), "quote": payload}


@router.delete("/{quote_id}", status_code=204)
def delete_quote(
    quote_id: QuoteId,
    request: Request,
    auth: tuple[User, UserSession] = Depends(guard()),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
):
    policy.check_quote_delete(auth[0])
    service.delete_quote(db, auth[0], quote_id, request_ip(request, settings))
    db.commit()
    return Response(status_code=204)
