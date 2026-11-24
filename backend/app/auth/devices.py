"""Connected devices: the super admin sees every active session and can end one or all of a person's."""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Path, Request, Response
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.auth import audit, policy, service
from app.auth.avatars_url import avatar_url
from app.auth.deps import get_db, get_settings_dep
from app.auth.errors import ApiError
from app.auth.guard import guard
from app.auth.routes import request_ip
from app.config import Settings
from app.models import User, UserSession

router = APIRouter(prefix="/api/admin")

reader = guard(csrf=False)


def _active():
    return (UserSession.revoked_at.is_(None), UserSession.expires_at > datetime.now(timezone.utc))


def _session_payload(row: UserSession, current: UserSession) -> dict:
    return {
        "id": str(row.id),
        "user_agent": row.user_agent,
        "created_at": row.created_at.isoformat(),
        "last_seen_at": row.last_seen_at.isoformat(),
        "ip": row.last_ip or row.ip,
        "country": row.country,
        "city": row.city,
        "current": row.token_hash == current.token_hash,
    }


@router.get("/devices")
def list_devices(auth: tuple[User, UserSession] = Depends(reader), db: Session = Depends(get_db)) -> dict:
    actor, current = auth
    policy.check_super_admin(actor)
    rows = db.execute(
        select(User, UserSession)
        .join(UserSession, UserSession.user_id == User.id)
        .where(*_active())
        .order_by(User.name, User.username, UserSession.last_seen_at.desc())
    ).all()
    groups: dict[int, dict] = {}
    for user, session in rows:
        group = groups.setdefault(
            user.id,
            {"user": {"id": user.id, "name": user.name, "username": user.username, "role": user.role, "avatar_url": avatar_url(user)}, "sessions": []},
        )
        group["sessions"].append(_session_payload(session, current))
    return {"users": list(groups.values())}


@router.delete("/devices/{device_id}", status_code=204)
def end_device(
    request: Request,
    device_id: str = Path(max_length=64),
    auth: tuple[User, UserSession] = Depends(guard()),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
):
    actor, current = auth
    policy.check_super_admin(actor)
    try:
        wanted = uuid.UUID(device_id)
    except ValueError:
        raise ApiError(404, "device_not_found")
    target = db.execute(select(UserSession).where(UserSession.id == wanted, *_active())).scalar_one_or_none()
    if target is None:
        raise ApiError(404, "device_not_found")
    target.revoked_at = datetime.now(timezone.utc)
    audit.log(db, "session_revoked", actor_user_id=actor.id, target_user_id=target.user_id, ip=request_ip(request, settings))
    db.commit()
    response = Response(status_code=204)
    if target.token_hash == current.token_hash:
        response.delete_cookie(service.SESSION_COOKIE, path="/api")
    return response


@router.post("/users/{user_id}/devices/logout-all", status_code=204)
def end_all_devices(
    request: Request,
    user_id: int = Path(ge=1, le=2**63 - 1),
    auth: tuple[User, UserSession] = Depends(guard()),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
):
    actor, current = auth
    policy.check_super_admin(actor)
    if db.get(User, user_id) is None:
        raise ApiError(404, "not_found")
    ended = db.execute(
        update(UserSession).where(UserSession.user_id == user_id, *_active()).values(revoked_at=datetime.now(timezone.utc)).returning(UserSession.token_hash)
    ).scalars().all()
    audit.log(db, "sessions_revoked_all", actor_user_id=actor.id, target_user_id=user_id, ip=request_ip(request, settings), details={"count": len(ended)})
    db.commit()
    response = Response(status_code=204)
    if current.token_hash in ended:
        response.delete_cookie(service.SESSION_COOKIE, path="/api")
    return response
