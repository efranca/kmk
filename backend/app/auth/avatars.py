"""Profile pictures: at most 50 KB, JPEG, PNG or WebP, kept in the database.

The browser crops and shrinks the picture before sending it; the server still checks the type (by its first bytes, never
by the name or the declared type) and the size, and serves it with headers that keep it an image and nothing else.
"""

import hashlib
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import audit, policy
from app.auth.admin import admin_actor, get_target
from app.auth.deps import get_db, get_settings_dep
from app.auth.errors import ApiError
from app.auth.guard import guard
from app.auth.routes import request_ip
from app.config import Settings
from app.models import User, UserAvatar, UserSession

MAX_BYTES = 51200

router = APIRouter()


def sniff(data: bytes) -> str | None:
    """The content type of a JPEG, PNG or WebP by its first bytes; None for anything else."""
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


async def _read_capped(request: Request) -> bytes:
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_BYTES:
        raise ApiError(422, "invalid_image")
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_BYTES:
            raise ApiError(422, "invalid_image")
        chunks.append(chunk)
    return b"".join(chunks)


def _remove(db: Session, target: User) -> bool:
    row = db.get(UserAvatar, target.id)
    if row is None:
        return False
    db.delete(row)
    target.avatar_updated_at = None
    return True


@router.put("/api/me/avatar", status_code=204)
async def set_avatar(
    request: Request,
    auth: tuple[User, UserSession] = Depends(guard()),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
):
    user, _ = auth
    data = await _read_capped(request)
    content_type = sniff(data)
    if not data or content_type is None:
        raise ApiError(422, "invalid_image")
    now = datetime.now(timezone.utc)
    row = db.get(UserAvatar, user.id)
    if row is None:
        db.add(UserAvatar(user_id=user.id, content_type=content_type, data=data, updated_at=now))
    else:
        row.content_type, row.data, row.updated_at = content_type, data, now
    user.avatar_updated_at = now
    audit.log(db, "avatar_set", actor_user_id=user.id, target_user_id=user.id, ip=request_ip(request, settings))
    db.commit()
    return Response(status_code=204)


@router.delete("/api/me/avatar", status_code=204)
def delete_own_avatar(
    request: Request,
    auth: tuple[User, UserSession] = Depends(guard()),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
):
    user, _ = auth
    if _remove(db, user):
        audit.log(db, "avatar_removed", actor_user_id=user.id, target_user_id=user.id, ip=request_ip(request, settings))
    db.commit()
    return Response(status_code=204)


@router.delete("/api/admin/users/{user_id}/avatar", status_code=204)
def remove_avatar_of(
    user_id: int,
    request: Request,
    actor: User = Depends(admin_actor),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
):
    """An administrator may take down a picture (never put one up for someone else): the same authority as editing the person."""
    target = get_target(db, user_id)
    if actor.id != target.id:
        policy.check(actor, target, "edit")
    if _remove(db, target):
        audit.log(db, "avatar_removed", actor_user_id=actor.id, target_user_id=target.id, ip=request_ip(request, settings))
    db.commit()
    return Response(status_code=204)


@router.get("/api/people/{user_id}/avatar")
def get_avatar(
    user_id: int,
    request: Request,
    auth: tuple[User, UserSession] = Depends(guard(csrf=False)),
    db: Session = Depends(get_db),
):
    row = db.scalar(select(UserAvatar).where(UserAvatar.user_id == user_id))
    if row is None:
        raise ApiError(404, "not_found")
    etag = '"' + hashlib.sha256(row.data).hexdigest()[:32] + '"'
    headers = {
        "ETag": etag,
        "Cache-Control": "private, max-age=0, must-revalidate",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'",
    }
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    return Response(content=row.data, media_type=row.content_type, headers=headers)
