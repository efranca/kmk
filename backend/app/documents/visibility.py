"""Who may see a document. One function, used in the SQL `WHERE` of every read (never a filter after loading)."""

LEVELS = ("everyone", "admins", "superadmin")

_BY_ROLE = {
    "user": frozenset({"everyone"}),
    "admin": frozenset({"everyone", "admins"}),
    "superadmin": frozenset(LEVELS),
}


def visible_levels(role: str) -> frozenset[str]:
    return _BY_ROLE.get(role, frozenset())


def can_view(role: str, visibility: str) -> bool:
    return visibility in visible_levels(role)
