import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.security import hash_token
from helpers import ORIGIN, login, sql

FEED_BASE = "https://app.kmk-entretien.ca/api/schedule/feed/"


def session(make_client, add_user, username, role="user"):
    add_user(username, f"{username}@example.com", role=role)
    c = make_client()
    token = login(c, username).json()["csrf_token"]
    return c, {**ORIGIN, "X-CSRF-Token": token}


def uid(owner_engine, username):
    return sql(owner_engine, "SELECT id FROM users WHERE username = :u", u=username)[0][0]


def raw_of(url):
    return url.rsplit("/", 1)[1][: -len(".ics")]


@pytest.fixture
def alice(make_client, add_user):
    return session(make_client, add_user, "alice")


# ---- storage and the account routes ----

def test_create_returns_url_once(alice, owner_engine):
    c, h = alice
    r = c.post("/api/account/calendar-feed", headers=h)
    assert r.status_code == 201, r.text
    url = r.json()["url"]
    assert url.startswith(FEED_BASE) and url.endswith(".ics")
    raw = raw_of(url)
    assert len(raw) >= 40
    stored = sql(owner_engine, "SELECT token_hash FROM calendar_feeds")[0][0]
    assert stored == hash_token(raw)
    info = c.get("/api/account/calendar-feed").json()
    assert info["exists"] is True and info["created_at"] and info["last_used_at"] is None
    assert raw not in str(info) and "url" not in info


def test_regenerate_replaces(alice, owner_engine):
    c, h = alice
    first = c.post("/api/account/calendar-feed", headers=h).json()["url"]
    second = c.post("/api/account/calendar-feed", headers=h).json()["url"]
    assert first != second
    rows = sql(owner_engine, "SELECT token_hash FROM calendar_feeds")
    assert rows == [(hash_token(raw_of(second)),)]


def test_revoke(alice):
    c, h = alice
    c.post("/api/account/calendar-feed", headers=h)
    assert c.delete("/api/account/calendar-feed", headers=h).status_code == 204
    assert c.get("/api/account/calendar-feed").json() == {"exists": False, "created_at": None, "last_used_at": None}
    assert c.delete("/api/account/calendar-feed", headers=h).status_code == 204


def test_audit_has_no_token(alice, owner_engine):
    c, h = alice
    raw = raw_of(c.post("/api/account/calendar-feed", headers=h).json()["url"])
    c.delete("/api/account/calendar-feed", headers=h)
    c.delete("/api/account/calendar-feed", headers=h)  # nothing to revoke: no second audit row
    rows = sql(owner_engine, "SELECT action, coalesce(details::text, '') FROM audit_log WHERE action LIKE 'calendar_feed_%' ORDER BY id")
    assert [r[0] for r in rows] == ["calendar_feed_created", "calendar_feed_revoked"]
    assert all(raw not in r[1] and hash_token(raw) not in r[1] for r in rows)


def test_mutations_need_csrf(alice):
    c, _ = alice
    assert c.post("/api/account/calendar-feed", headers=ORIGIN).status_code == 403
    assert c.delete("/api/account/calendar-feed", headers=ORIGIN).status_code == 403


def test_needs_a_session(make_client):
    c = make_client()
    assert c.get("/api/account/calendar-feed").status_code == 401


def test_feed_is_deleted_with_its_user(alice, owner_engine):
    c, h = alice
    c.post("/api/account/calendar-feed", headers=h)
    with owner_engine.begin() as db:
        db.execute(text("DELETE FROM sessions"))
        db.execute(text("DELETE FROM users WHERE username = 'alice'"))
    assert sql(owner_engine, "SELECT count(*) FROM calendar_feeds")[0][0] == 0


def test_app_role_can_use_the_table_and_feed_kind_is_valid(alice, owner_engine, app_engine):
    c, h = alice
    c.post("/api/account/calendar-feed", headers=h)
    with app_engine.begin() as db:
        db.execute(text("UPDATE calendar_feeds SET last_used_at = now()"))
        db.execute(text("INSERT INTO login_attempts (ip, identifier, success, kind) VALUES ('1.1.1.1', 'x', false, 'feed')"))
    with pytest.raises(IntegrityError):
        with owner_engine.begin() as db:
            db.execute(text("INSERT INTO calendar_feeds (user_id, token_hash) VALUES (:u, 'dup')"), {"u": uid(owner_engine, "alice")})
