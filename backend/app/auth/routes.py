from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth import audit, ratelimit, service
from app.config import Settings
from app.security import client_ip, csrf_token, verify_csrf

router = APIRouter(prefix="/api/auth")


def get_db(request: Request):
    with Session(request.app.state.engine, expire_on_commit=False) as db:
        yield db


def get_settings_dep(request: Request) -> Settings:
    return request.app.state.settings


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

    token, token_hash = service.create_session(db, user, settings, ip, request.headers.get("user-agent"))
    ratelimit.record_attempt(db, ip, identifier, True)
    audit.log(db, "login_success", actor_user_id=user.id, target_user_id=user.id, ip=ip)
    db.commit()

    response = JSONResponse({"user": service.user_payload(user), "csrf_token": csrf_token(token_hash, settings.session_secret)})
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
def me(request: Request, db: Session = Depends(get_db), settings: Settings = Depends(get_settings_dep)):
    found = service.current_session(db, request.cookies.get(service.SESSION_COOKIE))
    if not found:
        return error(401, "unauthenticated")
    user, session = found
    return {"user": service.user_payload(user), "csrf_token": csrf_token(session.token_hash, settings.session_secret)}


@router.post("/logout")
def logout(request: Request, db: Session = Depends(get_db), settings: Settings = Depends(get_settings_dep)):
    found = service.current_session(db, request.cookies.get(service.SESSION_COOKIE))
    if not found:
        return error(401, "unauthenticated")
    user, session = found
    if not verify_csrf(session.token_hash, settings.session_secret, request.headers.get("x-csrf-token", "")):
        return error(403, "forbidden")
    session.revoked_at = datetime.now(timezone.utc)
    audit.log(db, "logout", actor_user_id=user.id, target_user_id=user.id, ip=request_ip(request, settings))
    db.commit()
    response = Response(status_code=204)
    response.delete_cookie(service.SESSION_COOKIE, path="/api")
    return response
