import re
from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, field_validator
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import audit, service, tokens
from app.auth.account import queue_email
from app.auth.errors import ApiError
from app.auth.deps import get_db, get_settings_dep
from app.auth.guard import guard
from app.auth.routes import request_ip
from app.config import Settings
from app.models import User, UserSession

router = APIRouter(prefix="/api/admin")

USERNAME_RE = re.compile(r"^[a-z0-9._-]{3,32}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class NewUser(BaseModel):
    username: str
    email: str
    locale: Literal["fr-CA", "en", "pt-BR"]

    @field_validator("username")
    @classmethod
    def _username(cls, v: str) -> str:
        v = v.strip().lower()
        if not USERNAME_RE.match(v):
            raise ValueError("username must be 3-32 characters of a-z, 0-9, dot, dash or underscore")
        return v

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        v = v.strip().lower()
        if len(v) > 254 or not EMAIL_RE.match(v):
            raise ValueError("invalid email address")
        return v


def admin_actor(auth: tuple[User, UserSession] = Depends(guard())) -> User:
    user, _ = auth
    if user.role not in ("admin", "superadmin"):
        raise ApiError(403, "forbidden")
    return user


def get_target(db: Session, user_id: int) -> User:
    target = db.get(User, user_id)
    if target is None:
        raise ApiError(404, "not_found")
    return target


@router.post("/users", status_code=201)
def create_user(
    body: NewUser,
    request: Request,
    background: BackgroundTasks,
    actor: User = Depends(admin_actor),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
):
    user = User(username=body.username, email=body.email, locale=body.locale, role="user", status="invited", password_hash=None)
    db.add(user)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise ApiError(409, "already_exists")
    raw = tokens.issue_token(db, user.id, "invite", timedelta(hours=settings.invite_hours))
    audit.log(db, "user_invited", actor_user_id=actor.id, target_user_id=user.id, ip=request_ip(request, settings))
    queue_email(background, request, settings, "invite", user, raw)
    db.commit()
    return JSONResponse({"user": service.user_payload(user), "email_queued": True}, status_code=201)


@router.post("/users/{user_id}/invite", status_code=202)
def resend_invite(
    user_id: int,
    request: Request,
    background: BackgroundTasks,
    actor: User = Depends(admin_actor),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
):
    target = get_target(db, user_id)
    if target.status != "invited":
        raise ApiError(409, "not_invited")
    raw = tokens.issue_token(db, target.id, "invite", timedelta(hours=settings.invite_hours))
    audit.log(db, "invite_resent", actor_user_id=actor.id, target_user_id=target.id, ip=request_ip(request, settings))
    queue_email(background, request, settings, "invite", target, raw)
    db.commit()
    return {"status": "ok"}


@router.post("/users/{user_id}/reset", status_code=202)
def admin_reset(
    user_id: int,
    request: Request,
    background: BackgroundTasks,
    actor: User = Depends(admin_actor),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
):
    target = get_target(db, user_id)
    if target.role == "superadmin" and actor.role != "superadmin":
        raise ApiError(403, "forbidden")
    if target.status != "active":
        raise ApiError(409, "not_active")
    raw = tokens.issue_token(db, target.id, "reset", timedelta(minutes=settings.reset_minutes))
    audit.log(
        db,
        "password_reset_requested",
        actor_user_id=actor.id,
        target_user_id=target.id,
        ip=request_ip(request, settings),
        details={"via": "admin"},
    )
    queue_email(background, request, settings, "reset", target, raw)
    db.commit()
    return {"status": "ok"}
