"""Changes to a user's account state. No HTTP, no authority checks (see policy.py), never commits.

Every function raises ApiError (409 invalid_state / last_admin / not_enabled / already_exists) when the change is not
allowed by the account's current state.
"""

from datetime import datetime, timezone

from sqlalchemy import delete as sql_delete, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.errors import ApiError
from app.models import PushSubscription, User, UserAvatar

ROLES = ("user", "admin")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def revoke_sessions(db: Session, user_id: int) -> None:
    db.execute(text("UPDATE sessions SET revoked_at = now() WHERE user_id = :u AND revoked_at IS NULL"), {"u": user_id})


def drop_push(db: Session, user_id: int) -> None:
    """A disabled, deleted or demoted person stops getting notifications on their devices."""
    db.execute(sql_delete(PushSubscription).where(PushSubscription.user_id == user_id))


def void_tokens(db: Session, user_id: int) -> None:
    db.execute(text("UPDATE tokens SET used_at = now() WHERE user_id = :u AND used_at IS NULL"), {"u": user_id})


def ensure_not_last_admin(db: Session, target: User) -> None:
    """Refuse to remove the last active admin or super admin.

    The privileged rows are locked, so two concurrent requests cannot both pass the check.
    """
    if target.role not in ("admin", "superadmin") or target.status != "active":
        return
    ids = db.execute(
        text("SELECT id FROM users WHERE role IN ('admin', 'superadmin') AND status = 'active' FOR UPDATE")
    ).scalars().all()
    if not any(i != target.id for i in ids):
        raise ApiError(409, "last_admin")


def disable(db: Session, target: User) -> None:
    if target.status not in ("invited", "active"):
        raise ApiError(409, "invalid_state")
    ensure_not_last_admin(db, target)
    target.status = "disabled"
    target.updated_at = _now()
    revoke_sessions(db, target.id)
    drop_push(db, target.id)


def enable(db: Session, target: User) -> None:
    if target.status != "disabled":
        raise ApiError(409, "invalid_state")
    target.status = "invited" if target.password_hash is None else "active"
    target.updated_at = _now()


def delete(db: Session, target: User) -> None:
    if target.status == "deleted":
        raise ApiError(409, "invalid_state")
    ensure_not_last_admin(db, target)
    target.status = "deleted"
    target.deleted_at = _now()
    target.updated_at = _now()
    revoke_sessions(db, target.id)
    void_tokens(db, target.id)
    drop_push(db, target.id)
    # A deleted person's picture goes with the account (nobody can see it or take it down afterwards).
    db.execute(sql_delete(UserAvatar).where(UserAvatar.user_id == target.id))
    target.avatar_updated_at = None


def restore(db: Session, target: User) -> None:
    if target.status != "deleted":
        raise ApiError(409, "invalid_state")
    target.status = "disabled"  # an admin re-enables it deliberately
    target.deleted_at = None
    target.updated_at = _now()


def change_role(db: Session, target: User, new_role: str) -> None:
    if target.status == "deleted" or target.role not in ROLES or new_role not in ROLES or new_role == target.role:
        raise ApiError(409, "invalid_state")
    if target.role == "admin":
        ensure_not_last_admin(db, target)  # a demotion removes an admin
    target.role = new_role
    target.updated_at = _now()
    revoke_sessions(db, target.id)
    if new_role == "user":
        drop_push(db, target.id)


def update(db: Session, target: User, locale: str | None, email: str | None, name: str | None = None) -> list[str]:
    """Edit locale and name (any time) and email (only while invited). Returns the names of the fields that changed.

    `name` must already be cleaned (app.names.clean_name); the database constraint is the second line of defense.
    """
    if target.status == "deleted":
        raise ApiError(409, "invalid_state")
    if email is not None and target.status != "invited":
        raise ApiError(409, "invalid_state")
    changed = []
    if locale is not None and locale != target.locale:
        target.locale = locale
        changed.append("locale")
    if email is not None:
        email = email.strip().lower()
        if email != target.email:
            target.email = email
            changed.append("email")
    if name is not None and name != target.name:
        target.name = name
        changed.append("name")
    if changed:
        target.updated_at = _now()
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            raise ApiError(409, "already_exists")
        if "email" in changed:
            void_tokens(db, target.id)  # links already sent to the old address must stop working
    return changed


def reset_mfa(db: Session, target: User) -> None:
    if target.status == "deleted":
        raise ApiError(409, "invalid_state")
    if not target.mfa_enabled:
        raise ApiError(409, "not_enabled")
    target.mfa_enabled = False
    target.mfa_secret = None
    target.mfa_last_step = None
    target.updated_at = _now()
    db.execute(text("DELETE FROM recovery_codes WHERE user_id = :u"), {"u": target.id})
    revoke_sessions(db, target.id)
