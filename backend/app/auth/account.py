from datetime import datetime, timedelta, timezone

from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth import audit, ratelimit, service, tokens
from app.auth.errors import ApiError
from app.auth.deps import get_db, get_settings_dep
from app.auth.guard import guard
from app.auth.routes import request_ip
from app.config import Settings
from app.emails import sender
from app.emails.templates import build_link, render
from app.models import User, UserSession
from app.security import hash_password, validate_password_rules, verify_password

router = APIRouter(prefix="/api/auth")


class ForgotBody(BaseModel):
    identifier: str = Field(max_length=256)


class SetPasswordBody(BaseModel):
    token: str = Field(max_length=512)
    password: str = Field(max_length=1024)


class LocaleBody(BaseModel):
    locale: Literal["fr-CA", "en", "pt-BR"]


class ChangePasswordBody(BaseModel):
    current_password: str = Field(max_length=1024)
    new_password: str = Field(max_length=1024)


def weak_password(problems: list[str]) -> JSONResponse:
    return JSONResponse({"error": "weak_password", "rules": problems}, status_code=422)


def queue_email(background: BackgroundTasks, request: Request, settings: Settings, kind: str, user: User, raw_token: str) -> None:
    message = render(kind, user.locale, build_link(settings, raw_token, user.locale), user.email, user.name)
    background.add_task(sender.deliver, request.app.state.engine, settings, message, user.id)


@router.post("/forgot-password", status_code=202)
def forgot_password(
    body: ForgotBody,
    request: Request,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
):
    ip = request_ip(request, settings)
    identifier = service.normalize_identifier(body.identifier)
    ratelimit.serialize(db, ip, identifier, "reset_request")
    if ratelimit.is_limited(db, ip, identifier, settings, kind="reset_request"):
        raise ApiError(429, "too_many_attempts")
    ratelimit.record_attempt(db, ip, identifier, False, kind="reset_request")

    user = service.find_user(db, identifier)
    if user is not None and user.status == "active":
        raw = tokens.issue_token(db, user.id, "reset", timedelta(minutes=settings.reset_minutes))
        audit.log(db, "password_reset_requested", target_user_id=user.id, ip=ip, details={"via": "user"})
        queue_email(background, request, settings, "reset", user, raw)
    db.commit()
    # Same answer for every account state; the email goes out after the response.
    return {"status": "ok"}


@router.post("/set-password")
def set_password(body: SetPasswordBody, request: Request, db: Session = Depends(get_db), settings: Settings = Depends(get_settings_dep)):
    ip = request_ip(request, settings)
    # Bad-link guesses are limited per IP (the IP is also the "identifier" of this kind).
    ip_unit = ratelimit.ip_key(ip)
    ratelimit.serialize(db, ip, ip_unit, "token")
    if ratelimit.is_limited(db, ip, ip_unit, settings, kind="token"):
        raise ApiError(429, "too_many_attempts")

    # Rules first, so a typo does not burn the single-use link.
    problems = validate_password_rules(body.password)
    if problems:
        return weak_password(problems)

    def invalid() -> JSONResponse:
        db.rollback()
        ratelimit.record_attempt(db, ip, ip_unit, False, kind="token")
        db.commit()
        raise ApiError(400, "invalid_token")

    redeemed = tokens.redeem_token(db, body.token)
    if redeemed is None:
        invalid()
    user_id, purpose = redeemed
    user = db.get(User, user_id)
    if user is None or not (
        (purpose == "invite" and user.status == "invited")
        # A reset link may be used on a disabled account (sent by an admin to recover it); the status is NOT changed:
        # only an admin enabling the account lets the person in.
        or (purpose == "reset" and user.status in ("active", "disabled"))
    ):
        invalid()

    user.password_hash = hash_password(body.password)
    user.updated_at = datetime.now(timezone.utc)
    if purpose == "invite":
        user.status = "active"
    db.execute(text("UPDATE tokens SET used_at = now() WHERE user_id = :u AND used_at IS NULL"), {"u": user.id})
    if purpose == "reset":
        db.execute(text("UPDATE sessions SET revoked_at = now() WHERE user_id = :u AND revoked_at IS NULL"), {"u": user.id})
    audit.log(
        db,
        "invite_accepted" if purpose == "invite" else "password_reset_completed",
        actor_user_id=user.id,
        target_user_id=user.id,
        ip=ip,
    )
    db.commit()
    return {"status": "ok"}


@router.post("/change-password")
def change_password(
    body: ChangePasswordBody,
    request: Request,
    auth: tuple[User, UserSession] = Depends(guard()),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
):
    user, session = auth
    ip = request_ip(request, settings)
    ratelimit.serialize(db, ip, user.username)
    if ratelimit.is_limited(db, ip, user.username, settings):
        raise ApiError(429, "too_many_attempts")
    if not user.password_hash or not verify_password(user.password_hash, body.current_password):
        ratelimit.record_attempt(db, ip, user.username, False)
        db.commit()
        raise ApiError(403, "invalid_current_password")
    problems = validate_password_rules(body.new_password)
    if problems:
        return weak_password(problems)
    if body.new_password == body.current_password:
        raise ApiError(422, "same_password")

    user.password_hash = hash_password(body.new_password)
    user.updated_at = datetime.now(timezone.utc)
    db.execute(
        text("UPDATE sessions SET revoked_at = now() WHERE user_id = :u AND token_hash <> :cur AND revoked_at IS NULL"),
        {"u": user.id, "cur": session.token_hash},
    )
    audit.log(db, "password_changed", actor_user_id=user.id, target_user_id=user.id, ip=ip)
    db.commit()
    return {"status": "ok"}


@router.post("/locale")
def set_locale(
    body: LocaleBody,
    request: Request,
    auth: tuple[User, UserSession] = Depends(guard()),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
):
    """The signed-in user's own interface and email language."""
    user, _ = auth
    old = user.locale
    if body.locale != old:
        user.locale = body.locale
        user.updated_at = datetime.now(timezone.utc)
        audit.log(
            db,
            "locale_changed",
            actor_user_id=user.id,
            target_user_id=user.id,
            ip=request_ip(request, settings),
            details={"from": old, "to": body.locale},
        )
    db.commit()
    return {"user": service.user_payload(user)}
