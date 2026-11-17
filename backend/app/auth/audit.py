import json

from sqlalchemy import text
from sqlalchemy.orm import Session


def log(
    db: Session,
    action: str,
    *,
    actor_user_id: int | None = None,
    target_user_id: int | None = None,
    ip: str | None = None,
    details: dict | None = None,
) -> None:
    """Append an audit row. Plain INSERT without RETURNING: the app role has no SELECT on audit_log."""
    db.execute(
        text(
            "INSERT INTO audit_log (actor_user_id, action, target_user_id, ip, details) "
            "VALUES (:actor, :action, :target, :ip, CAST(:details AS jsonb))"
        ),
        dict(
            actor=actor_user_id,
            action=action,
            target=target_user_id,
            ip=ip,
            details=json.dumps(details) if details is not None else None,
        ),
    )
