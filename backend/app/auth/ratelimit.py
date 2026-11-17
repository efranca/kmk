from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import LoginAttempt


def is_limited(db: Session, ip: str, identifier: str, settings: Settings) -> bool:
    since = datetime.now(timezone.utc) - timedelta(minutes=settings.rl_window_minutes)

    def failures(column, value) -> int:
        return db.scalar(
            select(func.count()).select_from(LoginAttempt).where(
                LoginAttempt.success.is_(False), LoginAttempt.at >= since, column == value
            )
        )

    return failures(LoginAttempt.ip, ip) >= settings.rl_ip_max or failures(
        LoginAttempt.identifier, identifier
    ) >= settings.rl_identifier_max


def record_attempt(db: Session, ip: str, identifier: str, success: bool) -> None:
    db.add(LoginAttempt(ip=ip, identifier=identifier, success=success))
    # Keep the table small: anything older than a day is irrelevant to the rate limit window.
    db.query(LoginAttempt).filter(LoginAttempt.at < datetime.now(timezone.utc) - timedelta(days=1)).delete()
