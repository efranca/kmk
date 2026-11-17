from datetime import datetime, timedelta, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models import Token
from app.security import hash_token, new_session_token


def issue_token(db: Session, user_id: int, purpose: str, ttl: timedelta) -> str:
    """Create a single-use token and return the raw value (only its hash is stored).

    Any older unused token of the same purpose for this user stops working.
    """
    db.execute(
        text("UPDATE tokens SET used_at = now() WHERE user_id = :u AND purpose = :p AND used_at IS NULL"),
        {"u": user_id, "p": purpose},
    )
    raw = new_session_token()
    db.add(
        Token(
            token_hash=hash_token(raw),
            user_id=user_id,
            purpose=purpose,
            expires_at=datetime.now(timezone.utc) + ttl,
        )
    )
    db.flush()
    return raw


def redeem_token(db: Session, raw: str) -> tuple[int, str] | None:
    """Atomically consume a token. Exactly one concurrent caller can win."""
    row = db.execute(
        text(
            "UPDATE tokens SET used_at = now() "
            "WHERE token_hash = :h AND used_at IS NULL AND expires_at > now() "
            "RETURNING user_id, purpose"
        ),
        {"h": hash_token(raw)},
    ).first()
    return (row[0], row[1]) if row else None
