from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth import audit, ratelimit, service
from app.auth.deps import get_db, get_settings_dep  # noqa: F401  (re-exported for other modules)
from app.auth.guard import guard
from app.config import Settings
from app.models import User, UserSession
from app.security import client_ip, csrf_token

router = APIRouter(prefix="/api/auth")


def request_ip(request: Request, settings: Settings) -> str:
    peer = request.client.host if request.client else "unknown"
    return client_ip(peer, request.headers.get("x-real-client-ip"), settings.trusted_proxy_ips)


class LoginBody(BaseModel):
    identifier: str = Field(max_length=256)
    password: str = Field(max_length=1024)


def error(status: int, code: str) -> JSONResponse:
    return JSONResponse({"error": code}, status_code=status)


@router.post("/login")
def login(body: LoginBody, request: Request, db: Session = Depends(get_db), settings: Settings = Depends(get_settings_dep)):
    ip = request_ip(request, settings)
    identifier = service.normalize_identifier(body.identifier)

    if ratelimit.is_limited(db, ip, identifier, settings):
        audit.log(db, "login_rate_limited", ip=ip, details={"identifier": identifier})
        db.commit()
        return error(429, "too_many_attempts")

    user = service.authenticate(db, identifier, body.password)
    if user is None:
        ratelimit.record_attempt(db, ip, identifier, False)
        audit.log(db, "login_failed", ip=ip, details={"identifier": identifier})
        db.commit()
        return error(401, "invalid_credentials")

    verified = not user.mfa_enabled  # a user with TOTP must still prove a code before this session is fully usable
    token, token_hash = service.create_session(db, user, settings, ip, request.headers.get("user-agent"), mfa_verified=verified)
    ratelimit.record_attempt(db, ip, identifier, True)
    audit.log(db, "login_success", actor_user_id=user.id, target_user_id=user.id, ip=ip)
    db.commit()

    state = service.state_for(user, verified, settings)
    response = JSONResponse(service.auth_payload(user, state, csrf_token(token_hash, settings.session_secret)))
    response.set_cookie(
        service.SESSION_COOKIE,
        token,
        max_age=settings.session_days * 86400,
        path="/api",
        secure=settings.cookie_secure,
        httponly=True,
        samesite="strict",
    )
    return response


@router.get("/me")
def me(
    auth: tuple[User, UserSession] = Depends(guard(allow=("ok", "verify", "setup"), csrf=False)),
    settings: Settings = Depends(get_settings_dep),
):
    user, session = auth
    state = service.mfa_state(user, session, settings)
    return service.auth_payload(user, state, csrf_token(session.token_hash, settings.session_secret))


@router.post("/logout")
def logout(
    request: Request,
    auth: tuple[User, UserSession] = Depends(guard(allow=("ok", "verify", "setup"), csrf=True)),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
):
    user, session = auth
    session.revoked_at = datetime.now(timezone.utc)
    audit.log(db, "logout", actor_user_id=user.id, target_user_id=user.id, ip=request_ip(request, settings))
    db.commit()
    response = Response(status_code=204)
    response.delete_cookie(service.SESSION_COOKIE, path="/api")
    return response
