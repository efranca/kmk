from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app import mfa
from app.auth import audit, ratelimit
from app.auth.errors import ApiError
from app.config import Settings
from app.models import RecoveryCode, User


def need_key(settings: Settings) -> str:
    if not settings.mfa_encryption_key:
        raise ApiError(503, "mfa_unavailable")
    return settings.mfa_encryption_key


def check_not_limited(db: Session, user: User, ip: str, settings: Settings) -> None:
    if ratelimit.is_limited(db, ip, user.username, settings, kind="mfa"):
        raise ApiError(429, "too_many_attempts")


def reject(db: Session, user: User, ip: str, code: str, reason: str) -> None:
    """Count and audit a failed password/code check, then answer 403 `code`."""
    ratelimit.record_attempt(db, ip, user.username, False, kind="mfa")
    audit.log(db, "mfa_failed", actor_user_id=user.id, target_user_id=user.id, ip=ip, details={"reason": reason})
    db.commit()
    raise ApiError(403, code)


def verify_totp(db: Session, user: User, code: str, settings: Settings) -> bool:
    """Check a code against the user's (possibly pending) secret; a code can only be used once."""
    if not user.mfa_secret:
        return False
    try:
        secret = mfa.decrypt_secret(user.mfa_secret, need_key(settings))
    except ValueError:
        raise ApiError(503, "mfa_unavailable")  # stored with a different key than the configured one
    step = mfa.matching_step(secret, code, user.mfa_last_step)
    if step is None:
        return False
    changed = db.execute(
        text("UPDATE users SET mfa_last_step = :s WHERE id = :id AND (mfa_last_step IS NULL OR mfa_last_step < :s)"),
        {"s": step, "id": user.id},
    ).rowcount
    if changed != 1:
        return False
    user.mfa_last_step = step
    return True


def issue_recovery_codes(db: Session, user: User) -> list[str]:
    db.execute(text("DELETE FROM recovery_codes WHERE user_id = :u"), {"u": user.id})
    codes = mfa.new_recovery_codes()
    for code in codes:
        db.add(RecoveryCode(user_id=user.id, code_hash=mfa.hash_recovery_code(code)))
    db.flush()
    return codes


def consume_recovery_code(db: Session, user: User, code: str) -> bool:
    changed = db.execute(
        text("UPDATE recovery_codes SET used_at = now() WHERE user_id = :u AND code_hash = :h AND used_at IS NULL"),
        {"u": user.id, "h": mfa.hash_recovery_code(code)},
    ).rowcount
    return changed == 1


def remaining_recovery_codes(db: Session, user: User) -> int:
    return db.scalar(
        select(func.count()).select_from(RecoveryCode).where(RecoveryCode.user_id == user.id, RecoveryCode.used_at.is_(None))
    )


def revoke_other_sessions(db: Session, user_id: int, keep_token_hash: str) -> None:
    db.execute(
        text("UPDATE sessions SET revoked_at = now() WHERE user_id = :u AND token_hash <> :k AND revoked_at IS NULL"),
        {"u": user_id, "k": keep_token_hash},
    )
