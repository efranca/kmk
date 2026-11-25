"""Turning notifications on and off for one device. Admins and the super admin only."""

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.auth import audit
from app.auth.deps import get_db, get_settings_dep
from app.auth.errors import ApiError
from app.auth.guard import guard
from app.auth.routes import request_ip
from app.config import Settings
from app.models import PushSubscription, User, UserSession
from app.push import service

router = APIRouter(prefix="/api/push")
reader = guard(csrf=False)


def _admin(auth: tuple[User, UserSession]) -> User:
    if auth[0].role not in service.PRIVILEGED:
        raise ApiError(403, "forbidden")
    return auth[0]


class Keys(BaseModel):
    model_config = ConfigDict(extra="forbid")

    p256dh: str = Field(min_length=1, max_length=200)
    auth: str = Field(min_length=1, max_length=100)


class SubscriptionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    endpoint: str = Field(min_length=1, max_length=1000)
    keys: Keys

    @field_validator("endpoint")
    @classmethod
    def _https(cls, v: str) -> str:
        if not v.startswith("https://"):
            raise ValueError("the push address must be https")
        return v


class EndpointIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    endpoint: str = Field(min_length=1, max_length=1000)


@router.get("/key")
def public_key(auth: tuple[User, UserSession] = Depends(reader), settings: Settings = Depends(get_settings_dep)):
    _admin(auth)
    return {"key": settings.vapid_public_key or None}


@router.post("/subscriptions", status_code=201)
def subscribe(
    body: SubscriptionIn,
    request: Request,
    auth: tuple[User, UserSession] = Depends(guard()),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
):
    actor = _admin(auth)
    sub = db.scalar(select(PushSubscription).where(PushSubscription.endpoint == body.endpoint))
    if sub is None:
        sub = PushSubscription(endpoint=body.endpoint)
        db.add(sub)
    sub.user_id, sub.p256dh, sub.auth = actor.id, body.keys.p256dh, body.keys.auth
    sub.user_agent = (request.headers.get("user-agent") or "")[:300] or None
    audit.log(db, "push_subscribed", actor_user_id=actor.id, ip=request_ip(request, settings))
    db.commit()
    return {"status": "ok"}


@router.delete("/subscriptions", status_code=204)
def unsubscribe(
    body: EndpointIn,
    request: Request,
    auth: tuple[User, UserSession] = Depends(guard()),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
):
    actor = _admin(auth)
    db.execute(delete(PushSubscription).where(PushSubscription.endpoint == body.endpoint, PushSubscription.user_id == actor.id))
    audit.log(db, "push_unsubscribed", actor_user_id=actor.id, ip=request_ip(request, settings))
    db.commit()
    return Response(status_code=204)


@router.post("/test")
def test_push(
    request: Request,
    auth: tuple[User, UserSession] = Depends(guard()),
    settings: Settings = Depends(get_settings_dep),
):
    actor = _admin(auth)
    sent = service.send_to_user(request.app.state.engine, settings, actor.id, {"title": "KMK", "body": "Notifications are working", "url": "/settings"})
    return {"sent": sent}
