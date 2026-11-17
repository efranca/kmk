from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import LoginAttempt


def is_limited(db: Session, ip: str, identifier: str, settings: Settings, kind: str = "login") -> bool:
    since = datetime.now(timezone.utc) - timedelta(minutes=settings.rl_window_minutes)

    def failures(column, value) -> int:
        return db.scalar(
            select(func.count()).select_from(LoginAttempt).where(
                LoginAttempt.success.is_(False), LoginAttempt.kind == kind, LoginAttempt.at >= since, column == value
            )
        )

    return failures(LoginAttempt.ip, ip) >= settings.rl_ip_max or failures(
        LoginAttempt.identifier, identifier
    ) >= settings.rl_identifier_max


def record_attempt(db: Session, ip: str, identifier: str, success: bool, kind: str = "login") -> None:
    db.add(LoginAttempt(ip=ip, identifier=identifier, success=success, kind=kind))
    # Keep the table small: anything older than a day is irrelevant to the rate limit window.
    db.query(LoginAttempt).filter(LoginAttempt.at < datetime.now(timezone.utc) - timedelta(days=1)).delete()


def serialize(db: Session, ip: str, identifier: str, kind: str = "login") -> None:
    """Make concurrent attempts for the same address / identifier take turns.

    Without this, N parallel requests all pass the "is it limited?" check before any of them records its failure.
    Transaction-scoped advisory locks (held until the request commits or rolls back); always taken in sorted order,
    so two requests cannot deadlock each other.
    """
    for key in sorted({f"{kind}:ip:{ip}", f"{kind}:id:{identifier}"}):
        db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": key})
