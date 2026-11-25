"""Sending Web Push notifications to admins' devices. Never raises: a notification must not break what triggered it."""

import json
import logging

from pywebpush import WebPushException, webpush
from sqlalchemy import Engine, delete, func, select
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import PushSubscription, User

log = logging.getLogger("kmk.push")
PRIVILEGED = ("admin", "superadmin")
TTL_SECONDS = 24 * 3600
GONE = (404, 410)


def configured(settings: Settings) -> bool:
    return bool(settings.vapid_public_key and settings.vapid_private_key)


def _send_all(engine: Engine, settings: Settings, payload: dict, user_id: int | None) -> int:
    if not configured(settings):
        return 0
    sent = 0
    data = json.dumps(payload)
    with Session(engine) as db:
        query = select(PushSubscription).join(User, User.id == PushSubscription.user_id).where(User.role.in_(PRIVILEGED), User.status == "active")
        if user_id is not None:
            query = query.where(PushSubscription.user_id == user_id)
        for sub in db.scalars(query).all():
            try:
                webpush(
                    subscription_info={"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}},
                    data=data,
                    vapid_private_key=settings.vapid_private_key,
                    vapid_claims={"sub": settings.vapid_subject},
                    ttl=TTL_SECONDS,
                )
            except WebPushException as exc:
                status = getattr(getattr(exc, "response", None), "status_code", None)
                if status in GONE:
                    db.execute(delete(PushSubscription).where(PushSubscription.id == sub.id))  # the device is gone
                else:
                    log.warning("push failed: HTTP %s", status)
                continue
            except Exception as exc:
                log.warning("push failed: %s", type(exc).__name__)
                continue
            sub.last_used_at = func.now()
            sent += 1
        db.commit()
    return sent


def send_to_admins(engine: Engine, settings: Settings, payload: dict) -> None:
    try:
        _send_all(engine, settings, payload, None)
    except Exception as exc:
        log.warning("push crashed: %s", type(exc).__name__)


def send_to_user(engine: Engine, settings: Settings, user_id: int, payload: dict) -> int:
    try:
        return _send_all(engine, settings, payload, user_id)
    except Exception as exc:
        log.warning("push crashed: %s", type(exc).__name__)
        return 0
