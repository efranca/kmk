from collections.abc import Callable

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.auth import service
from app.auth.deps import get_db, get_settings_dep
from app.auth.errors import ApiError
from app.config import Settings
from app.models import User, UserSession
from app.security import verify_csrf


def guard(*, allow: tuple[str, ...] = ("ok",), csrf: bool = True) -> Callable:
    """Dependency protecting a route: a valid session, a CSRF token (when `csrf`), and an allowed MFA state.

    The default allows only fully verified sessions, so a new route is safe unless it opts out explicitly.
    Runs before request-body validation.
    """

    def dependency(
        request: Request,
        db: Session = Depends(get_db),
        settings: Settings = Depends(get_settings_dep),
    ) -> tuple[User, UserSession]:
        found = service.current_session(db, request.cookies.get(service.SESSION_COOKIE))
        if not found:
            raise ApiError(401, "unauthenticated")
        user, session = found
        if csrf and not verify_csrf(session.token_hash, settings.session_secret, request.headers.get("x-csrf-token", "")):
            raise ApiError(403, "forbidden")
        state = service.mfa_state(user, session, settings)
        if state not in allow:
            raise ApiError(403, "mfa_required" if state == "verify" else "mfa_setup_required")
        return user, session

    return dependency
