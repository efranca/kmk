"""Who may do what to whom. The single source of truth for admin authority (pure functions, no database).

Order of checks: (1) the actor must be an admin or the super admin; (2) nobody disables, deletes, re-roles or
resets the two-step verification of themselves; (3) the matrix: only the super admin acts on admins, admins act on
plain users, and the super admin account is untouchable. The one exception to the matrix: anyone with admin
powers may reset their own password, and the super admin may edit their own account.
"""

from app.auth.errors import ApiError
from app.models import User

ACTIONS = ("view", "edit", "resend_invite", "reset_password", "reset_mfa", "disable", "enable", "delete", "restore", "set_role")

PRIVILEGED = ("admin", "superadmin")
SELF_DESTRUCTIVE = frozenset({"disable", "delete", "set_role", "reset_mfa"})


def authority_error(actor: User, target: User, action: str) -> ApiError | None:
    if actor.role not in PRIVILEGED:
        return ApiError(403, "forbidden")
    if action in SELF_DESTRUCTIVE and actor.id == target.id:
        return ApiError(403, "cannot_target_self")
    if action == "view":
        return None
    if action == "reset_password" and actor.id == target.id:
        return None  # an admin or the super admin may reset their own password
    if action == "edit" and actor.role == "superadmin" and actor.id == target.id:
        return None  # the super admin may fix their own name and language (nobody else may edit the super admin)
    if target.role == "superadmin":
        return ApiError(403, "forbidden")
    if action == "set_role":
        return None if actor.role == "superadmin" and target.role in ("user", "admin") else ApiError(403, "forbidden")
    if target.role == "admin":
        return None if actor.role == "superadmin" else ApiError(403, "forbidden")
    return None  # target is a plain user: admins and the super admin may act


def check(actor: User, target: User, action: str) -> None:
    error = authority_error(actor, target, action)
    if error is not None:
        raise error


def check_super_admin(actor: User) -> None:
    """Actions that concern the whole app rather than one person (for example connected devices): the super admin only."""
    if actor.role != "superadmin":
        raise ApiError(403, "forbidden")


def state_allows(target: User, action: str) -> bool:
    status = target.status
    if action == "view":
        return True
    if action == "resend_invite":
        return status == "invited"
    if action == "reset_password":
        # A disabled account may be reset: that is how a taken-over account is recovered while it stays locked out.
        return status in ("active", "disabled")
    if action == "reset_mfa":
        return bool(target.mfa_enabled) and status != "deleted"
    if action == "disable":
        return status in ("invited", "active")
    if action == "enable":
        return status == "disabled"
    if action == "delete":
        return status != "deleted"
    if action == "restore":
        return status == "deleted"
    if action in ("edit", "set_role"):
        return status != "deleted"
    return False


def available_actions(actor: User, target: User) -> list[str]:
    return [a for a in ACTIONS if authority_error(actor, target, a) is None and state_allows(target, a)]


def can_invite_role(actor: User, role: str) -> bool:
    if role == "user":
        return actor.role in PRIVILEGED
    if role == "admin":
        return actor.role == "superadmin"
    return False


def can_change_event(actor: User, creator_id: int, person_ids: frozenset[int]) -> bool:
    """Who may edit or delete a schedule event: an admin or the super admin, its creator, or a person it is for.
    An event for everyone (no listed people) can be changed only by its creator or an admin."""
    if actor.role in PRIVILEGED or actor.id == creator_id:
        return True
    return actor.id in person_ids


def check_event(actor: User, creator_id: int, person_ids: frozenset[int]) -> None:
    if not can_change_event(actor, creator_id, person_ids):
        raise ApiError(403, "forbidden")


def can_change_task(actor: User, creator_id: int, person_ids: frozenset[int]) -> bool:
    """Who may edit or delete a task: an admin or the super admin, its creator, or a person it is for.
    A task for the whole team (no listed people) can be changed only by its creator or an admin."""
    return actor.role in PRIVILEGED or actor.id == creator_id or actor.id in person_ids


def can_set_task_status(actor: User, creator_id: int, person_ids: frozenset[int]) -> bool:
    """Who may complete or reopen a task: whoever may edit it, and anyone for a task for the whole team."""
    return can_change_task(actor, creator_id, person_ids) or not person_ids


def can_manage_task_categories(actor: User) -> bool:
    """Anyone adds a category; only admins rename, re-icon or delete one."""
    return actor.role in PRIVILEGED


def can_manage_documents(actor: User) -> bool:
    """Who adds, edits, replaces and deletes company documents and manages their categories."""
    return actor.role in PRIVILEGED


def check_documents(actor: User) -> None:
    if not can_manage_documents(actor):
        raise ApiError(403, "forbidden")


def check_task(actor: User, creator_id: int, person_ids: frozenset[int]) -> None:
    if not can_change_task(actor, creator_id, person_ids):
        raise ApiError(403, "forbidden")


def check_task_status(actor: User, creator_id: int, person_ids: frozenset[int]) -> None:
    if not can_set_task_status(actor, creator_id, person_ids):
        raise ApiError(403, "forbidden")
