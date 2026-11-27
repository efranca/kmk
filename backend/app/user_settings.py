"""Per-person settings that administrators manage (unlike `preferences`, which people change themselves).

One closed JSON object in `users.settings`: a new setting is a new key here (default + validation), not a new column.
"""

from pydantic import BaseModel, ConfigDict, ValidationError

DEFAULTS: dict = {"notify_quotes": False}


class SettingsIn(BaseModel):
    """Any subset. Strict types: "yes" is not a boolean."""

    model_config = ConfigDict(extra="forbid", strict=True)

    notify_quotes: bool | None = None


def patch_of(model: SettingsIn) -> dict:
    return model.model_dump(exclude_none=True)


def normalize(raw: object) -> dict:
    """The stored object with defaults filled in; unknown keys and invalid values are dropped."""
    stored = raw if isinstance(raw, dict) else {}
    kept: dict = {}
    for key, value in stored.items():
        if key not in DEFAULTS:
            continue
        try:
            kept.update(patch_of(SettingsIn.model_validate({key: value})))
        except ValidationError:
            continue
    return {**DEFAULTS, **kept}
