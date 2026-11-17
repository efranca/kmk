import threading
from datetime import timedelta

from sqlalchemy.orm import Session

from app.auth import tokens
from app.security import hash_token
from helpers import sql


def user_id(owner_engine) -> int:
    return sql(owner_engine, "SELECT id FROM users LIMIT 1")[0][0]


def issue(engine, uid, purpose="reset", ttl=timedelta(minutes=30)) -> str:
    with Session(engine) as db:
        raw = tokens.issue_token(db, uid, purpose, ttl)
        db.commit()
    return raw


def redeem(engine, raw):
    with Session(engine) as db:
        result = tokens.redeem_token(db, raw)
        db.commit()
    return result


def test_issue_stores_only_the_hash(owner_engine, app_engine, add_user):
    add_user()
    raw = issue(app_engine, user_id(owner_engine))
    stored = [r[0] for r in sql(owner_engine, "SELECT token_hash FROM tokens")]
    assert stored == [hash_token(raw)] and raw not in stored


def test_redeem_once_only(owner_engine, app_engine, add_user):
    add_user()
    uid = user_id(owner_engine)
    raw = issue(app_engine, uid, "invite")
    assert redeem(app_engine, raw) == (uid, "invite")
    assert redeem(app_engine, raw) is None
    assert redeem(app_engine, "never-issued") is None


def test_expired_token_is_rejected(owner_engine, app_engine, add_user):
    add_user()
    raw = issue(app_engine, user_id(owner_engine), ttl=timedelta(seconds=-1))
    assert redeem(app_engine, raw) is None


def test_new_token_supersedes_older_of_same_purpose_only(owner_engine, app_engine, add_user):
    add_user()
    uid = user_id(owner_engine)
    first = issue(app_engine, uid, "reset")
    other_purpose = issue(app_engine, uid, "invite")
    second = issue(app_engine, uid, "reset")
    assert redeem(app_engine, first) is None
    assert redeem(app_engine, second) == (uid, "reset")
    assert redeem(app_engine, other_purpose) == (uid, "invite")


def test_concurrent_redeem_has_exactly_one_winner(owner_engine, app_engine, add_user):
    add_user()
    raw = issue(app_engine, user_id(owner_engine))
    barrier = threading.Barrier(2)
    results = []

    def worker():
        with Session(app_engine) as db:
            barrier.wait()
            results.append(tokens.redeem_token(db, raw))
            db.commit()

    threads = [threading.Thread(target=worker) for _ in range(2)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert sorted(r is not None for r in results) == [False, True]
