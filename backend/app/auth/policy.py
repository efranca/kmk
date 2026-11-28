"""Who may do what to whom. The single source of truth for admin authority (pure functions, no database).

Order of checks: (1) the actor must be an admin or the super admin; (2) nobody disables, deletes, re-roles or
resets the two-step verification of themselves; (3) the matrix: only the super admin acts on admins, admins act on
plain users, and the super admin account is untouchable. The one exception to the matrix: anyone with admin
powers may reset their own password, and the super admin may edit their own account.
"""

from app.auth.errors import ApiError
from app.models import User

ACTIONS = ("view", "edit", "resend_invite", "reset_password", "reset_mfa", "disable", "enable", "delete", "restore", "purge", "set_role")

PRIVILEGED = ("admin", "superadmin")
SELF_DESTRUCTIVE = frozenset({"disable", "delete", "purge", "set_role", "reset_mfa"})


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
    if action == "purge":
        return None if actor.role == "superadmin" else ApiError(403, "forbidden")  # deleting for good: the super admin only
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
    if action in ("restore", "purge"):
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


def can_change_event(actor: User, creator_id: int | None, person_ids: frozenset[int], creator_is_staff: bool = True) -> bool:
    """Who may edit or delete a schedule event: an admin or the super admin; otherwise (Staff) the creator, or a person it is
    for, but never when an administrator (or the website) made it: those events are only read by Staff."""
    if actor.role in PRIVILEGED:
        return True
    if not creator_is_staff:
        return False
    return actor.id == creator_id or actor.id in person_ids


def check_event(actor: User, creator_id: int | None, person_ids: frozenset[int], creator_is_staff: bool = True) -> None:
    if not can_change_event(actor, creator_id, person_ids, creator_is_staff):
        raise ApiError(403, "forbidden")


def can_see_item(actor: User, creator_id: int | None, person_ids: frozenset[int]) -> bool:
    """Who sees a task or a schedule event: an admin or the super admin see all; staff see the ones that list them, and
    the ones they made themselves (so something they just added never vanishes). An item with no people is for admins."""
    return actor.role in PRIVILEGED or actor.id == creator_id or actor.id in person_ids


def can_change_task(actor: User, creator_id: int | None, person_ids: frozenset[int], creator_is_staff: bool = True) -> bool:
    """Who may edit or delete a task: an admin or the super admin; otherwise (Staff) its creator or a person it is for, but
    never when an administrator (or the website) made it: Staff only move and complete those."""
    if actor.role in PRIVILEGED:
        return True
    return creator_is_staff and (actor.id == creator_id or actor.id in person_ids)


def can_set_task_status(actor: User, creator_id: int | None, person_ids: frozenset[int]) -> bool:
    """Who may move, start, complete or reopen a task: an admin, its creator, or a person it is for (whoever made it)."""
    return actor.role in PRIVILEGED or actor.id == creator_id or actor.id in person_ids


def can_manage_task_categories(actor: User) -> bool:
    """Only admins add, rename, re-icon or delete a category (staff can still put a task in one)."""
    return actor.role in PRIVILEGED


def can_manage_documents(actor: User) -> bool:
    """Who adds, edits, replaces and deletes company documents and manages their categories."""
    return actor.role in PRIVILEGED


def check_documents(actor: User) -> None:
    if not can_manage_documents(actor):
        raise ApiError(403, "forbidden")


def check_task(actor: User, creator_id: int | None, person_ids: frozenset[int], creator_is_staff: bool = True) -> None:
    if not can_change_task(actor, creator_id, person_ids, creator_is_staff):
        raise ApiError(403, "forbidden")


def check_task_status(actor: User, creator_id: int | None, person_ids: frozenset[int]) -> None:
    if not can_set_task_status(actor, creator_id, person_ids):
        raise ApiError(403, "forbidden")


def can_manage_quotes(actor: User) -> bool:
    """Who reads quote requests, replies to customers and changes a quote's status: admins and the super admin."""
    return actor.role in PRIVILEGED


def check_quotes(actor: User) -> None:
    if not can_manage_quotes(actor):
        raise ApiError(403, "forbidden")


def can_manage_clients(actor: User) -> bool:
    """Who reads and edits clients: admins and the super admin (Staff see only the clients they are scheduled for: later)."""
    return actor.role in PRIVILEGED


def check_clients(actor: User) -> None:
    if not can_manage_clients(actor):
        raise ApiError(403, "forbidden")


def check_quote_delete(actor: User) -> None:
    """Deleting a customer's request (and its photos and conversation) is for the super admin only."""
    if actor.role != "superadmin":
        raise ApiError(403, "forbidden")


def check_invoice_purge(actor: User) -> None:
    """Deleting an invoice for good (its lines and stored PDF too) is for the super admin only."""
    if actor.role != "superadmin":
        raise ApiError(403, "forbidden")


def can_manage_invoices(actor: User) -> bool:
    """Who bills clients and reads invoices and prices: admins and the super admin (never Staff)."""
    return actor.role in PRIVILEGED


def check_invoices(actor: User) -> None:
    if not can_manage_invoices(actor):
        raise ApiError(403, "forbidden")


def can_see_visit(actor: User, listed_ids: frozenset[int], checked_in_ids: frozenset[int]) -> bool:
    """Who sees a visit (an Agenda occurrence with a property) and its check-ins: admins and the super admin see all;
    anyone else only when the occurrence lists them, or when they have a check-in on it (so a person taken off the
    Agenda item still sees the record of what they did). Unlike `can_see_item`, having made the event is not enough."""
    return actor.role in PRIVILEGED or actor.id in listed_ids or actor.id in checked_in_ids


def check_visit_admin(actor: User) -> None:
    """The "Visits done" report and anything about every visit at once: admins and the super admin."""
    if actor.role not in PRIVILEGED:
        raise ApiError(403, "forbidden")
