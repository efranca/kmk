import ipaddress
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import LoginAttempt


def ip_key(ip: str) -> str:
    """The unit an address is counted as. An IPv6 /64 is one customer's whole allocation (an attacker can rotate through
    2^64 addresses in it), so it counts as one source; IPv4 and unrecognised values are used as they are."""
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return ip
    if addr.version == 6:
        if addr.ipv4_mapped is not None:
            return str(addr.ipv4_mapped)
        return str(ipaddress.ip_network(f"{addr}/64", strict=False))
    return str(addr)


def is_limited(db: Session, ip: str, identifier: str, settings: Settings, kind: str = "login") -> bool:
    since = datetime.now(timezone.utc) - timedelta(minutes=settings.rl_window_minutes)
    ip = ip_key(ip)

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
    db.add(LoginAttempt(ip=ip_key(ip), identifier=identifier, success=success, kind=kind))
    # Keep the table small: anything older than a day is irrelevant to the rate limit window.
    db.query(LoginAttempt).filter(LoginAttempt.at < datetime.now(timezone.utc) - timedelta(days=1)).delete()


def serialize(db: Session, ip: str, identifier: str, kind: str = "login") -> None:
    """Make concurrent attempts for the same address / identifier take turns.

    Without this, N parallel requests all pass the "is it limited?" check before any of them records its failure.
    Transaction-scoped advisory locks (held until the request commits or rolls back); always taken in sorted order,
    so two requests cannot deadlock each other.
    """
    for key in sorted({f"{kind}:ip:{ip_key(ip)}", f"{kind}:id:{identifier}"}):
        db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": key})
