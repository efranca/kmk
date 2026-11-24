from datetime import datetime, timedelta, timezone

from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import User, UserSession
from app.auth.avatars_url import avatar_url
from app.preferences import normalize as normalize_preferences
from app.security import DUMMY_HASH, hash_password, hash_token, needs_rehash, new_session_token, verify_password

SESSION_COOKIE = "kmk_session"


def normalize_identifier(identifier: str) -> str:
    return identifier.strip().lower()[:256]


def find_user(db: Session, identifier: str) -> User | None:
    return db.scalar(select(User).where(or_(User.username == identifier, User.email == identifier)))


def authenticate(db: Session, identifier: str, password: str) -> User | None:
    """Exactly one Argon2 verification happens whether or not the user exists."""
    user = find_user(db, identifier)
    # Invited users have no password yet: they are verified against the dummy hash like unknown users.
    ok = verify_password(user.password_hash if user and user.password_hash else DUMMY_HASH, password)
    if not (user and user.password_hash and ok and user.status == "active"):
        return None
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(password)
    return user


def create_session(
    db: Session,
    user: User,
    settings: Settings,
    ip: str,
    user_agent: str | None,
    mfa_verified: bool = True,
    country: str | None = None,
    city: str | None = None,
) -> tuple[str, str]:
    """Returns (raw cookie token, stored token hash)."""
    token = new_session_token()
    token_hash = hash_token(token)
    db.add(
        UserSession(
            token_hash=token_hash,
            user_id=user.id,
            expires_at=datetime.now(timezone.utc) + timedelta(days=settings.session_days),
            ip=ip,
            last_ip=ip,
            country=country,
            city=city,
            user_agent=(user_agent or "")[:512] or None,
            mfa_verified=mfa_verified,
        )
    )
    return token, token_hash


def current_session(db: Session, token: str | None) -> tuple[User, UserSession] | None:
    if not token:
        return None
    row = db.execute(
        select(User, UserSession)
        .join(UserSession, UserSession.user_id == User.id)
        .where(
            UserSession.token_hash == hash_token(token),
            UserSession.revoked_at.is_(None),
            UserSession.expires_at > datetime.now(timezone.utc),
            User.status == "active",
        )
    ).first()
    return (row[0], row[1]) if row else None


SEEN_EVERY = timedelta(minutes=5)


def touch_session(db: Session, session: UserSession, ip: str, country: str | None, city: str | None) -> None:
    """Record last access, address and place, at most once every 5 minutes per session (a GET is not a write each time)."""
    result = db.execute(
        update(UserSession)
        .where(UserSession.token_hash == session.token_hash, UserSession.last_seen_at < datetime.now(timezone.utc) - SEEN_EVERY)
        .values(last_seen_at=func.now(), last_ip=ip, country=country, city=city)
    )
    if result.rowcount:
        db.commit()


def user_payload(user: User) -> dict:
    return {"id": user.id, "username": user.username, "name": user.name, "email": user.email, "role": user.role, "locale": user.locale, "avatar_url": avatar_url(user)}


def state_for(user: User, verified: bool, settings: Settings) -> str:
    """ok / verify (has TOTP, not yet proven this session) / setup (role requires TOTP, none enrolled)."""
    if user.mfa_enabled and not verified:
        return "verify"
    if not user.mfa_enabled and user.role in settings.required_roles:
        return "setup"
    return "ok"


def mfa_state(user: User, session: UserSession, settings: Settings) -> str:
    return state_for(user, session.mfa_verified, settings)


def auth_payload(user: User, state: str, csrf: str) -> dict:
    return {
        "user": user_payload(user),
        "csrf_token": csrf,
        "mfa": state,
        "mfa_enabled": user.mfa_enabled,
        "preferences": normalize_preferences(user.preferences),
    }
