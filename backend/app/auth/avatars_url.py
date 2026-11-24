"""The address a profile picture is served from (kept apart so the user payload can use it without importing routes)."""

from app.models import User


def avatar_url(user: User) -> str | None:
    """Where the picture is served, with its date so a new picture is fetched afresh; None when there is none."""
    if user.avatar_updated_at is None:
        return None
    return f"/api/people/{user.id}/avatar?v={int(user.avatar_updated_at.timestamp())}"
