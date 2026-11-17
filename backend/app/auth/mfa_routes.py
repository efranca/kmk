from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import mfa
from app.auth import audit, mfa_service as svc, service
from app.auth.deps import get_db, get_settings_dep
from app.auth.errors import ApiError
from app.auth.guard import guard
from app.auth.routes import request_ip
from app.config import Settings
from app.models import User, UserSession
from app.security import verify_password

router = APIRouter(prefix="/api/auth/mfa")

Auth = tuple[User, UserSession]


class CodeBody(BaseModel):
    code: str = Field(max_length=32)


class VerifyBody(BaseModel):
    code: str | None = Field(default=None, max_length=32)
    recovery_code: str | None = Field(default=None, max_length=64)

    @model_validator(mode="after")
    def exactly_one(self):
        if (self.code is None) == (self.recovery_code is None):
            raise ValueError("send either code or recovery_code")
        return self


class PasswordAndCode(BaseModel):
    password: str = Field(max_length=1024)
    code: str = Field(max_length=32)


@router.post("/setup")
def setup(
    auth: Auth = Depends(guard(allow=("ok", "setup"))),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
):
    key = svc.need_key(settings)
    user, _ = auth
    if user.mfa_enabled:
        raise ApiError(409, "already_enabled")
    secret = mfa.new_secret()
    user.mfa_secret = mfa.encrypt_secret(secret, key)  # pending until /enable confirms a code
    user.mfa_last_step = None
    db.commit()
    return {"secret": secret, "otpauth_uri": mfa.provisioning_uri(secret, user.username, settings.mfa_issuer)}


@router.post("/enable")
def enable(
    body: CodeBody,
    request: Request,
    auth: Auth = Depends(guard(allow=("ok", "setup"))),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
):
    svc.need_key(settings)
    user, session = auth
    ip = request_ip(request, settings)
    if user.mfa_enabled:
        raise ApiError(409, "already_enabled")
    if not user.mfa_secret:
        raise ApiError(409, "no_pending_setup")
    svc.check_not_limited(db, user, ip, settings)
    if not svc.verify_totp(db, user, body.code, settings):
        svc.reject(db, user, ip, "invalid_code", "code")
    user.mfa_enabled = True
    codes = svc.issue_recovery_codes(db, user)
    session.mfa_verified = True
    svc.revoke_other_sessions(db, user.id, session.token_hash)
    audit.log(db, "mfa_enrolled", actor_user_id=user.id, target_user_id=user.id, ip=ip)
    db.commit()
    return {"recovery_codes": codes}


@router.post("/verify")
def verify(
    body: VerifyBody,
    request: Request,
    auth: Auth = Depends(guard(allow=("verify", "ok"))),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
):
    svc.need_key(settings)
    user, session = auth
    if session.mfa_verified:
        raise ApiError(409, "already_verified")
    ip = request_ip(request, settings)
    svc.check_not_limited(db, user, ip, settings)
    if body.code is not None:
        if not svc.verify_totp(db, user, body.code, settings):
            svc.reject(db, user, ip, "invalid_code", "code")
        action = "mfa_verified"
    else:
        if not svc.consume_recovery_code(db, user, body.recovery_code):
            svc.reject(db, user, ip, "invalid_code", "recovery_code")
        action = "recovery_code_used"
    session.mfa_verified = True
    audit.log(db, action, actor_user_id=user.id, target_user_id=user.id, ip=ip)
    remaining = svc.remaining_recovery_codes(db, user)
    db.commit()
    return {"status": "ok", "recovery_codes_remaining": remaining}


def check_password_and_code(db: Session, user: User, body: PasswordAndCode, ip: str, settings: Settings) -> None:
    svc.check_not_limited(db, user, ip, settings)
    if not user.password_hash or not verify_password(user.password_hash, body.password):
        svc.reject(db, user, ip, "invalid_current_password", "password")
    if not svc.verify_totp(db, user, body.code, settings):
        svc.reject(db, user, ip, "invalid_code", "code")


@router.post("/disable")
def disable(
    body: PasswordAndCode,
    request: Request,
    auth: Auth = Depends(guard()),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
):
    svc.need_key(settings)
    user, session = auth
    if user.role in settings.required_roles:
        raise ApiError(403, "mfa_mandatory")
    if not user.mfa_enabled:
        raise ApiError(409, "not_enabled")
    ip = request_ip(request, settings)
    check_password_and_code(db, user, body, ip, settings)
    user.mfa_enabled = False
    user.mfa_secret = None
    user.mfa_last_step = None
    db.execute(text("DELETE FROM recovery_codes WHERE user_id = :u"), {"u": user.id})
    svc.revoke_other_sessions(db, user.id, session.token_hash)
    audit.log(db, "mfa_disabled", actor_user_id=user.id, target_user_id=user.id, ip=ip)
    db.commit()
    return {"status": "ok"}


@router.post("/recovery-codes/regenerate")
def regenerate(
    body: PasswordAndCode,
    request: Request,
    auth: Auth = Depends(guard()),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
):
    svc.need_key(settings)
    user, _ = auth
    if not user.mfa_enabled:
        raise ApiError(409, "not_enabled")
    ip = request_ip(request, settings)
    check_password_and_code(db, user, body, ip, settings)
    codes = svc.issue_recovery_codes(db, user)
    audit.log(db, "recovery_codes_regenerated", actor_user_id=user.id, target_user_id=user.id, ip=ip)
    db.commit()
    return {"recovery_codes": codes}
