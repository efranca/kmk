import pytest

from app.auth import policy
from app.auth.errors import ApiError
from app.models import User

ALL = set(policy.ACTIONS)
SELF_DESTRUCTIVE = {"disable", "delete", "set_role", "reset_mfa"}


def user(id, role="user", status="active", mfa=False, password=True):
    return User(
        id=id,
        username=f"u{id}",
        email=f"u{id}@example.com",
        role=role,
        status=status,
        mfa_enabled=mfa,
        password_hash="hash" if password else None,
    )


def verdict(actor, target, action):
    err = policy.authority_error(actor, target, action)
    return None if err is None else (err.status, err.code)


FORBIDDEN = (403, "forbidden")
SELF = (403, "cannot_target_self")

# Expected outcomes written out by hand (not derived from the implementation's own rules).
# key: (actor role, target role, same person?) -> (allowed actions, {action: (status, code)} for the refused ones)
def expected(actor_role, target_role, same):
    if actor_role == "user":
        return {a: FORBIDDEN for a in ALL}
    out = {}
    for a in ALL:
        out[a] = FORBIDDEN
    out["view"] = None
    if actor_role == "admin":
        if target_role == "user":
            for a in ALL - {"set_role"}:
                out[a] = None
        if same:
            for a in SELF_DESTRUCTIVE:
                out[a] = SELF
            out["reset_password"] = None  # anyone with admin powers may reset their own password
    if actor_role == "superadmin":
        if target_role in ("user", "admin") and not same:
            for a in ALL:
                out[a] = None
        if target_role == "superadmin" and same:
            out["reset_password"] = None
            for a in SELF_DESTRUCTIVE:
                out[a] = SELF
    return out


CASES = [
    ("user", "user", False),
    ("user", "admin", False),
    ("user", "superadmin", False),
    ("admin", "user", False),
    ("admin", "admin", False),
    ("admin", "admin", True),
    ("admin", "superadmin", False),
    ("superadmin", "user", False),
    ("superadmin", "admin", False),
    ("superadmin", "superadmin", True),
    ("superadmin", "superadmin", False),
]


@pytest.mark.parametrize("actor_role,target_role,same", CASES)
def test_authority_matrix(actor_role, target_role, same):
    actor = user(1, actor_role)
    target = actor if same else user(2, target_role)
    want = expected(actor_role, target_role, same)
    for action in policy.ACTIONS:
        assert verdict(actor, target, action) == want[action], (actor_role, target_role, same, action)


def test_check_raises_what_authority_error_returns():
    with pytest.raises(ApiError) as e:
        policy.check(user(1, "admin"), user(2, "admin"), "disable")
    assert (e.value.status, e.value.code) == FORBIDDEN
    with pytest.raises(ApiError) as e:
        admin = user(1, "admin")
        policy.check(admin, admin, "delete")
    assert (e.value.status, e.value.code) == SELF
    policy.check(user(1, "admin"), user(2, "user"), "disable")  # no error


@pytest.mark.parametrize(
    "action,status,mfa,allowed",
    [
        ("view", "deleted", False, True),
        ("resend_invite", "invited", False, True),
        ("resend_invite", "active", False, False),
        ("reset_password", "active", False, True),
        ("reset_password", "invited", False, False),
        ("reset_password", "disabled", False, True),
        ("reset_password", "invited", False, False),
        ("reset_mfa", "active", True, True),
        ("reset_mfa", "active", False, False),
        ("reset_mfa", "deleted", True, False),
        ("disable", "invited", False, True),
        ("disable", "active", False, True),
        ("disable", "disabled", False, False),
        ("disable", "deleted", False, False),
        ("enable", "disabled", False, True),
        ("enable", "active", False, False),
        ("delete", "invited", False, True),
        ("delete", "active", False, True),
        ("delete", "disabled", False, True),
        ("delete", "deleted", False, False),
        ("restore", "deleted", False, True),
        ("restore", "disabled", False, False),
        ("edit", "active", False, True),
        ("edit", "deleted", False, False),
        ("set_role", "disabled", False, True),
        ("set_role", "deleted", False, False),
    ],
)
def test_state_allows(action, status, mfa, allowed):
    assert policy.state_allows(user(2, status=status, mfa=mfa), action) is allowed


def test_available_actions_examples():
    admin, root = user(1, "admin"), user(9, "superadmin")
    assert policy.available_actions(admin, user(2, mfa=True)) == ["view", "edit", "reset_password", "reset_mfa", "disable", "delete"]
    assert policy.available_actions(admin, user(3, "admin")) == ["view"]
    assert policy.available_actions(root, user(3, "admin", status="invited", password=False)) == [
        "view", "edit", "resend_invite", "disable", "delete", "set_role",
    ]
    assert policy.available_actions(admin, user(4, status="deleted")) == ["view", "restore"]
    assert policy.available_actions(admin, user(6, status="disabled")) == ["view", "edit", "reset_password", "enable", "delete"]
    assert policy.available_actions(admin, root) == ["view"]
    assert policy.available_actions(root, root) == ["view", "reset_password"]
    assert policy.available_actions(admin, admin) == ["view", "reset_password"]  # admins can reset their own password too
    assert policy.available_actions(user(5), user(2)) == []  # a plain user has no admin powers at all


@pytest.mark.parametrize(
    "actor_role,role,allowed",
    [
        ("admin", "user", True),
        ("admin", "admin", False),
        ("admin", "superadmin", False),
        ("superadmin", "user", True),
        ("superadmin", "admin", True),
        ("superadmin", "superadmin", False),
        ("superadmin", "nonsense", False),
        ("user", "user", False),
    ],
)
def test_can_invite_role(actor_role, role, allowed):
    assert policy.can_invite_role(user(1, actor_role), role) is allowed
