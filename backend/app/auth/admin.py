import re
from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, field_validator, model_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import audit, lifecycle, policy, service, tokens
from app.auth.account import queue_email
from app.auth.deps import get_db, get_settings_dep
from app.auth.errors import ApiError
from app.auth.guard import guard
from app.auth.routes import request_ip
from app.config import Settings
from app.models import User, UserSession

router = APIRouter(prefix="/api/admin")

USERNAME_RE = re.compile(r"^[a-z0-9._-]{3,32}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
Locale = Literal["fr-CA", "en", "pt-BR"]


def clean_email(v: str) -> str:
    v = v.strip().lower()
    if len(v) > 254 or not EMAIL_RE.match(v):
        raise ValueError("invalid email address")
    return v


class NewUser(BaseModel):
    username: str
    email: str
    locale: Locale
    role: Literal["user", "admin"] = "user"

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
        return clean_email(v)


class EditUser(BaseModel):
    locale: Locale | None = None
    email: str | None = None

    @field_validator("email")
    @classmethod
    def _email(cls, v: str | None) -> str | None:
        return None if v is None else clean_email(v)

    @model_validator(mode="after")
    def _something_to_change(self):
        if self.locale is None and self.email is None:
            raise ValueError("send locale and/or email")
        return self


class RoleBody(BaseModel):
    role: Literal["user", "admin"]


def admin_actor(auth: tuple[User, UserSession] = Depends(guard())) -> User:
    user, _ = auth
    if user.role not in policy.PRIVILEGED:
        raise ApiError(403, "forbidden")
    return user


def admin_reader(auth: tuple[User, UserSession] = Depends(guard(csrf=False))) -> User:
    user, _ = auth
    if user.role not in policy.PRIVILEGED:
        raise ApiError(403, "forbidden")
    return user


def get_target(db: Session, user_id: int) -> User:
    target = db.get(User, user_id)
    if target is None:
        raise ApiError(404, "not_found")
    return target


def row_payload(actor: User, user: User, last_sign_in) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "role": user.role,
        "locale": user.locale,
        "status": user.status,
        "mfa_enabled": user.mfa_enabled,
        "created_at": user.created_at.isoformat(),
        "last_sign_in": last_sign_in.isoformat() if last_sign_in else None,
        "actions": policy.available_actions(actor, user),
    }


@router.get("/users")
def list_users(actor: User = Depends(admin_reader), db: Session = Depends(get_db)):
    users = db.scalars(select(User).order_by(User.username)).all()
    last = dict(db.execute(select(UserSession.user_id, func.max(UserSession.created_at)).group_by(UserSession.user_id)).all())
    return {"users": [row_payload(actor, u, last.get(u.id)) for u in users]}


@router.post("/users", status_code=201)
def create_user(
    body: NewUser,
    request: Request,
    background: BackgroundTasks,
    actor: User = Depends(admin_actor),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
):
    if not policy.can_invite_role(actor, body.role):
        raise ApiError(403, "forbidden")
    user = User(username=body.username, email=body.email, locale=body.locale, role=body.role, status="invited", password_hash=None)
    db.add(user)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise ApiError(409, "already_exists")
    raw = tokens.issue_token(db, user.id, "invite", timedelta(hours=settings.invite_hours))
    audit.log(db, "user_invited", actor_user_id=actor.id, target_user_id=user.id, ip=request_ip(request, settings), details={"role": body.role})
    queue_email(background, request, settings, "invite", user, raw)
    db.commit()
    return JSONResponse({"user": service.user_payload(user), "email_queued": True}, status_code=201)


@router.patch("/users/{user_id}")
def edit_user(
    user_id: int,
    body: EditUser,
    request: Request,
    actor: User = Depends(admin_actor),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
):
    target = get_target(db, user_id)
    policy.check(actor, target, "edit")
    changed = lifecycle.update(db, target, body.locale, body.email)
    if changed:
        # Field names only: values (such as an email address) never go into the audit log.
        audit.log(db, "user_updated", actor_user_id=actor.id, target_user_id=target.id, ip=request_ip(request, settings), details={"fields": changed})
    db.commit()
    return {"user": service.user_payload(target)}


def simple_action(action: str, event: str, change, user_id: int, request: Request, actor: User, db: Session, settings: Settings) -> dict:
    target = get_target(db, user_id)
    policy.check(actor, target, action)
    change(db, target)
    audit.log(db, event, actor_user_id=actor.id, target_user_id=target.id, ip=request_ip(request, settings))
    db.commit()
    return {"status": "ok"}


@router.post("/users/{user_id}/disable")
def disable_user(user_id: int, request: Request, actor: User = Depends(admin_actor), db: Session = Depends(get_db), settings: Settings = Depends(get_settings_dep)):
    return simple_action("disable", "user_disabled", lifecycle.disable, user_id, request, actor, db, settings)


@router.post("/users/{user_id}/enable")
def enable_user(user_id: int, request: Request, actor: User = Depends(admin_actor), db: Session = Depends(get_db), settings: Settings = Depends(get_settings_dep)):
    return simple_action("enable", "user_enabled", lifecycle.enable, user_id, request, actor, db, settings)


@router.post("/users/{user_id}/delete")
def delete_user(user_id: int, request: Request, actor: User = Depends(admin_actor), db: Session = Depends(get_db), settings: Settings = Depends(get_settings_dep)):
    return simple_action("delete", "user_deleted", lifecycle.delete, user_id, request, actor, db, settings)


@router.post("/users/{user_id}/restore")
def restore_user(user_id: int, request: Request, actor: User = Depends(admin_actor), db: Session = Depends(get_db), settings: Settings = Depends(get_settings_dep)):
    return simple_action("restore", "user_restored", lifecycle.restore, user_id, request, actor, db, settings)


@router.post("/users/{user_id}/role")
def change_user_role(
    user_id: int,
    body: RoleBody,
    request: Request,
    actor: User = Depends(admin_actor),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
):
    target = get_target(db, user_id)
    policy.check(actor, target, "set_role")
    old = target.role
    lifecycle.change_role(db, target, body.role)
    audit.log(
        db,
        "user_role_changed",
        actor_user_id=actor.id,
        target_user_id=target.id,
        ip=request_ip(request, settings),
        details={"from": old, "to": body.role},
    )
    db.commit()
    return {"user": service.user_payload(target)}


@router.post("/users/{user_id}/reset-mfa")
def reset_user_mfa(user_id: int, request: Request, actor: User = Depends(admin_actor), db: Session = Depends(get_db), settings: Settings = Depends(get_settings_dep)):
    target = get_target(db, user_id)
    policy.check(actor, target, "reset_mfa")
    lifecycle.reset_mfa(db, target)
    audit.log(db, "mfa_reset", actor_user_id=actor.id, target_user_id=target.id, ip=request_ip(request, settings), details={"via": "admin"})
    db.commit()
    return {"status": "ok"}


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
    policy.check(actor, target, "resend_invite")
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
    policy.check(actor, target, "reset_password")
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
