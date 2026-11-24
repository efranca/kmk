"""Per-account preferences: one closed, validated JSON object (the application fills in the defaults)."""

from copy import deepcopy
from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, ValidationError
from sqlalchemy.orm import Session

from app.auth.deps import get_db
from app.auth.guard import guard
from app.models import User, UserSession

DEFAULTS: dict = {
    "theme": "kmk",
    "sidebar_collapsed": False,
    "tasks_view": "list",
    "show_tasks_on_schedule": False,
    "show_task_categories": False,
    "show_document_categories": False,
    "show_menu_labels": True,
    "documents_view": "list",
    "dashboard_widgets": {"my_events": True, "all_events": True, "my_tasks": True},
}


class WidgetsIn(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    my_events: bool | None = None
    all_events: bool | None = None
    my_tasks: bool | None = None


class PreferencesIn(BaseModel):
    """Any subset. Strict types: "yes" is not a boolean."""

    model_config = ConfigDict(extra="forbid", strict=True)

    theme: Literal["kmk", "light", "dark"] | None = None
    sidebar_collapsed: bool | None = None
    tasks_view: Literal["list", "board"] | None = None
    show_tasks_on_schedule: bool | None = None
    show_task_categories: bool | None = None
    show_document_categories: bool | None = None
    show_menu_labels: bool | None = None
    documents_view: Literal["list", "tiles"] | None = None
    dashboard_widgets: WidgetsIn | None = None


def _patch_of(model: PreferencesIn) -> dict:
    return model.model_dump(exclude_none=True)


def _merge(base: dict, patch: dict) -> dict:
    out = deepcopy(base)
    for key, value in patch.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = {**out[key], **value}
        else:
            out[key] = value
    return out


def normalize(raw: object) -> dict:
    """The stored object with defaults filled in. Unknown keys and invalid values (from an older or hand-edited row) are dropped."""
    stored = raw if isinstance(raw, dict) else {}
    kept: dict = {}
    for key, value in stored.items():
        if key not in DEFAULTS:
            continue
        try:
            kept.update(_patch_of(PreferencesIn.model_validate({key: value})))
        except ValidationError:
            continue
    return _merge(DEFAULTS, kept)


router = APIRouter(prefix="/api/me")


@router.patch("/preferences")
def patch_preferences(
    body: PreferencesIn,
    request: Request,
    auth: tuple[User, UserSession] = Depends(guard()),
    db: Session = Depends(get_db),
):
    user, _ = auth
    # Lock the row: two quick changes (two tabs, two toggles) are merged one after the other, not over each other.
    db.refresh(user, with_for_update=True)
    merged = _merge(normalize(user.preferences), _patch_of(body))
    user.preferences = merged  # assigned whole, so SQLAlchemy sees the change
    db.commit()
    return {"preferences": normalize(user.preferences)}
