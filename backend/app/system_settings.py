"""Company-wide settings the super admin edits in the app (no restart): who gets quote notices, the quote sender and
Reply-To, and the public phone number. Stored as text in `app_settings`; an unset key reads as an empty string."""

import re

from fastapi import APIRouter, Depends, Request
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.auth import audit
from app.auth.admin import clean_email
from app.auth.deps import get_db, get_settings_dep
from app.auth.errors import ApiError
from app.auth.guard import guard
from app.auth.routes import request_ip
from app.config import Settings
from app.models import AppSetting, User, UserSession

KEYS = ("quote_notify_email", "quote_from", "quote_reply_to", "public_phone")

_PHONE_RE = re.compile(r"^[0-9 +().\-]{7,30}$")
_SENDER_RE = re.compile(r"^(?:[^<>\r\n]{1,100}<([^<>\s@]+@[^<>\s@]+\.[^<>\s@]+)>|([^<>\s@]+@[^<>\s@]+\.[^<>\s@]+))$")


def get_all(db: Session) -> dict[str, str]:
    stored = dict(db.execute(select(AppSetting.key, AppSetting.value)).all())
    return {key: stored.get(key, "") for key in KEYS}


def get(db: Session, key: str) -> str:
    return get_all(db)[key]


def _clean(key: str, raw: object) -> str:
    if not isinstance(raw, str):
        raise ApiError(422, "invalid")
    value = raw.strip()
    if value == "":
        return ""
    try:
        if key in ("quote_notify_email", "quote_reply_to"):
            return clean_email(value)
    except ValueError:
        raise ApiError(422, "invalid")
    if key == "quote_from" and len(value) <= 200 and _SENDER_RE.match(value):
        return value
    if key == "public_phone" and _PHONE_RE.match(value):
        return value
    raise ApiError(422, "invalid")


router = APIRouter(prefix="/api/settings")


def _superadmin(auth: tuple[User, UserSession]) -> User:
    if auth[0].role != "superadmin":
        raise ApiError(403, "forbidden")
    return auth[0]


@router.get("/system")
def read_system(auth: tuple[User, UserSession] = Depends(guard(csrf=False)), db: Session = Depends(get_db)):
    _superadmin(auth)
    return {"settings": get_all(db)}


@router.patch("/system")
async def change_system(
    request: Request,
    auth: tuple[User, UserSession] = Depends(guard()),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
):
    actor = _superadmin(auth)
    try:
        body = await request.json()
    except ValueError:
        raise ApiError(422, "invalid")
    if not isinstance(body, dict) or not body or any(key not in KEYS for key in body):
        raise ApiError(422, "invalid")
    clean = {key: _clean(key, value) for key, value in body.items()}
    for key, value in clean.items():
        db.execute(
            insert(AppSetting).values(key=key, value=value, updated_by=actor.id).on_conflict_do_update(
                index_elements=["key"], set_={"value": value, "updated_by": actor.id, "updated_at": func.now()}
            )
        )
    audit.log(db, "settings_changed", actor_user_id=actor.id, ip=request_ip(request, settings), details={"keys": sorted(clean)})
    db.commit()
    return {"settings": get_all(db)}
