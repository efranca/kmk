import threading

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth import lifecycle
from app.auth.errors import ApiError
from app.models import User
from helpers import PW, login, sql


def load(db, username) -> User:
    return db.query(User).filter(User.username == username).one()


def state(owner_engine, username):
    return tuple(sql(owner_engine, "SELECT status, deleted_at IS NOT NULL FROM users WHERE username = :u", u=username)[0])


@pytest.fixture
def db(app_engine, owner_engine):
    with Session(app_engine) as s:
        yield s
        s.rollback()


def run(db, fn, *args):
    fn(db, *args)
    db.commit()


def refused(db, fn, *args) -> str:
    with pytest.raises(ApiError) as e:
        fn(db, *args)
    db.rollback()
    return f"{e.value.status} {e.value.code}"


def test_disable_and_enable(db, add_user, owner_engine):
    add_user("active1", "a1@example.com")
    add_user("fresh", "f@example.com", password=None, status="invited")
    run(db, lifecycle.disable, load(db, "active1"))
    run(db, lifecycle.disable, load(db, "fresh"))
    assert state(owner_engine, "active1")[0] == "disabled" and state(owner_engine, "fresh")[0] == "disabled"
    run(db, lifecycle.enable, load(db, "active1"))
    run(db, lifecycle.enable, load(db, "fresh"))
    assert state(owner_engine, "active1")[0] == "active"
    assert state(owner_engine, "fresh")[0] == "invited"  # no password yet: back to invited


def test_refused_transitions(db, add_user):
    add_user("act", "act@example.com")
    add_user("dis", "dis@example.com", status="disabled")
    add_user("del", "del@example.com", status="deleted")
    assert refused(db, lifecycle.enable, load(db, "act")) == "409 invalid_state"
    assert refused(db, lifecycle.disable, load(db, "dis")) == "409 invalid_state"
    assert refused(db, lifecycle.disable, load(db, "del")) == "409 invalid_state"
    assert refused(db, lifecycle.delete, load(db, "del")) == "409 invalid_state"
    assert refused(db, lifecycle.restore, load(db, "act")) == "409 invalid_state"
    assert refused(db, lifecycle.restore, load(db, "dis")) == "409 invalid_state"


def test_delete_and_restore(db, add_user, make_token, owner_engine):
    add_user("bob", "bob@example.com")
    make_token("bob", "reset")
    run(db, lifecycle.delete, load(db, "bob"))
    assert state(owner_engine, "bob") == ("deleted", True)
    assert sql(owner_engine, "SELECT count(*) FROM tokens WHERE used_at IS NULL")[0][0] == 0
    run(db, lifecycle.restore, load(db, "bob"))
    assert state(owner_engine, "bob") == ("disabled", False)


def test_sessions_are_revoked(db, make_client, add_user, add_mfa_user, owner_engine):
    add_user("a", "a@example.com")
    add_user("b", "b@example.com")
    add_mfa_user("m")
    for name in ("a", "b", "m"):
        login(make_client(), name)
    uid = lambda n: sql(owner_engine, "SELECT id FROM users WHERE username = :u", u=n)[0][0]
    open_sessions = lambda n: sql(owner_engine, "SELECT count(*) FROM sessions WHERE user_id = :i AND revoked_at IS NULL", i=uid(n))[0][0]

    run(db, lifecycle.disable, load(db, "a"))
    assert (open_sessions("a"), open_sessions("b"), open_sessions("m")) == (0, 1, 1)
    run(db, lifecycle.change_role, load(db, "b"), "admin")
    assert open_sessions("b") == 0 and open_sessions("m") == 1
    run(db, lifecycle.reset_mfa, load(db, "m"))
    assert open_sessions("m") == 0
    add_user("c", "c@example.com")
    login(make_client(), "c")
    run(db, lifecycle.delete, load(db, "c"))
    assert open_sessions("c") == 0


def test_change_role(db, add_user, owner_engine):
    add_user("u1", "u1@example.com")
    add_user("root", "root@example.com", role="superadmin")
    add_user("gone", "gone@example.com", status="deleted")
    add_user("adm", "adm@example.com", role="admin")
    run(db, lifecycle.change_role, load(db, "u1"), "admin")
    assert sql(owner_engine, "SELECT role FROM users WHERE username = 'u1'")[0][0] == "admin"
    run(db, lifecycle.change_role, load(db, "u1"), "user")
    assert sql(owner_engine, "SELECT role FROM users WHERE username = 'u1'")[0][0] == "user"
    assert refused(db, lifecycle.change_role, load(db, "u1"), "user") == "409 invalid_state"  # no change
    assert refused(db, lifecycle.change_role, load(db, "root"), "user") == "409 invalid_state"
    assert refused(db, lifecycle.change_role, load(db, "gone"), "admin") == "409 invalid_state"
    assert refused(db, lifecycle.change_role, load(db, "u1"), "superadmin") == "409 invalid_state"


def test_update(db, add_user, owner_engine):
    add_user("act", "act@example.com")
    add_user("inv", "inv@example.com", password=None, status="invited")
    add_user("del", "del@example.com", status="deleted")
    assert lifecycle.update(db, load(db, "act"), "en", None) == ["locale"]
    db.commit()
    assert sql(owner_engine, "SELECT locale FROM users WHERE username = 'act'")[0][0] == "en"
    assert lifecycle.update(db, load(db, "inv"), "pt-BR", "NEW@Example.com") == ["locale", "email"]
    db.commit()
    assert sql(owner_engine, "SELECT email FROM users WHERE username = 'inv'")[0][0] == "new@example.com"
    assert refused(db, lifecycle.update, load(db, "act"), None, "other@example.com") == "409 invalid_state"
    assert refused(db, lifecycle.update, load(db, "del"), "en", None) == "409 invalid_state"
    assert lifecycle.update(db, load(db, "act"), None, None) == []


def test_reset_mfa(db, add_user, add_mfa_user, owner_engine):
    add_mfa_user("m")
    add_user("plain", "plain@example.com")
    run(db, lifecycle.reset_mfa, load(db, "m"))
    assert tuple(sql(owner_engine, "SELECT mfa_enabled, mfa_secret, mfa_last_step FROM users WHERE username = 'm'")[0]) == (False, None, None)
    assert sql(owner_engine, "SELECT count(*) FROM recovery_codes")[0][0] == 0
    assert refused(db, lifecycle.reset_mfa, load(db, "plain")) == "409 not_enabled"
    add_mfa_user("gone", status="deleted")
    assert refused(db, lifecycle.reset_mfa, load(db, "gone")) == "409 invalid_state"  # same rule as policy.state_allows


def test_last_admin_invariant(db, add_user, owner_engine):
    add_user("solo", "solo@example.com", role="admin")
    add_user("plain", "plain@example.com")
    add_user("off", "off@example.com", role="admin", status="disabled")
    target = load(db, "solo")
    for fn, args in ((lifecycle.disable, ()), (lifecycle.delete, ()), (lifecycle.change_role, ("user",))):
        assert refused(db, fn, target, *args) == "409 last_admin", fn.__name__
    lifecycle.ensure_not_last_admin(db, load(db, "plain"))  # not privileged: never blocked
    lifecycle.ensure_not_last_admin(db, load(db, "off"))  # not active: never blocked
    add_user("second", "second@example.com", role="admin")
    run(db, lifecycle.disable, load(db, "solo"))  # now allowed: another active admin remains
    assert state(owner_engine, "solo")[0] == "disabled"


def test_last_admin_invariant_holds_under_concurrency(app_engine, owner_engine, add_user):
    add_user("adm1", "adm1@example.com", role="admin")
    add_user("adm2", "adm2@example.com", role="admin")
    barrier = threading.Barrier(2)
    outcomes = []

    def worker(username):
        with Session(app_engine) as db:
            target = load(db, username)
            barrier.wait()  # both read the same starting state, then race to demote
            try:
                lifecycle.change_role(db, target, "user")
                db.commit()
                outcomes.append("ok")
            except ApiError as e:
                db.rollback()
                outcomes.append(e.code)

    threads = [threading.Thread(target=worker, args=(n,)) for n in ("adm1", "adm2")]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert sorted(outcomes) == ["last_admin", "ok"]
    assert sql(owner_engine, "SELECT count(*) FROM users WHERE role = 'admin' AND status = 'active'")[0][0] == 1
