from sqlalchemy.orm import Session

from app.auth import ratelimit
from helpers import make_settings


def fail(engine, ip, identifier, kind=None, n=1):
    with Session(engine) as db:
        for _ in range(n):
            if kind is None:
                ratelimit.record_attempt(db, ip, identifier, False)
            else:
                ratelimit.record_attempt(db, ip, identifier, False, kind=kind)
        db.commit()


def limited(engine, ip, identifier, kind):
    with Session(engine) as db:
        return ratelimit.is_limited(db, ip, identifier, make_settings(rl_identifier_max=2, rl_ip_max=2), kind=kind)


def test_identifier_failures_are_counted_per_kind(owner_engine, app_engine):
    fail(app_engine, "1.1.1.1", "a", n=2)  # default kind is "login"
    assert limited(app_engine, "9.9.9.9", "a", "login") is True
    assert limited(app_engine, "9.9.9.9", "a", "reset_request") is False


def test_ip_failures_are_counted_per_kind(owner_engine, app_engine):
    fail(app_engine, "2.2.2.2", "x", kind="reset_request")
    fail(app_engine, "2.2.2.2", "y", kind="reset_request")
    assert limited(app_engine, "2.2.2.2", "z", "reset_request") is True
    assert limited(app_engine, "2.2.2.2", "z", "login") is False
    assert limited(app_engine, "2.2.2.2", "z", "token") is False
