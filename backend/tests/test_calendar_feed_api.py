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
    return session(make_client, add_user, "alice", role="admin")


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


# ---- the public feed ----

from datetime import datetime  # noqa: E402

WEEKLY_THU = {"freq": "weekly", "interval": 1, "weekdays": ["THU"], "month_day": None, "nth_weekdays": []}
NOT_FOUND = '{"error":"not_found"}'


@pytest.fixture(autouse=True)
def frozen_clock(monkeypatch):
    from app.schedule import service
    monkeypatch.setattr(service, "now_toronto", lambda: datetime(2026, 11, 26, 12, 0))


@pytest.fixture
def bob(make_client, add_user):
    return session(make_client, add_user, "bob")


def event(c, h, **kw):
    base = {"title": "Visit", "start_date": "2026-11-27", "start_time": "09:00", "duration_minutes": 60}
    base.update(kw)
    r = c.post("/api/schedule/events", json=base, headers=h)
    assert r.status_code == 201, r.text
    return r.json()["event"]["id"]


def make_feed(c, h):
    return c.post("/api/account/calendar-feed", headers=h).json()["url"]


def fetch(c, url):
    return c.get(url.replace("https://app.kmk-entretien.ca", ""))


def test_only_assigned_titles_and_times(alice, bob, owner_engine, make_client):
    c, h = alice
    me, other = uid(owner_engine, "alice"), uid(owner_engine, "bob")
    event(c, h, title="Mine", notes="12 client street", people=[me])
    event(c, h, title="Shared", people=[me, other])
    event(c, h, title="Everyone")
    event(c, h, title="Bobs", people=[other])
    r = fetch(make_client(), make_feed(c, h))  # a fresh client: no cookie
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "text/calendar; charset=utf-8"
    assert r.headers["cache-control"] == "private, no-store"
    assert "SUMMARY:Mine\r\n" in r.text and "SUMMARY:Shared\r\n" in r.text
    assert "Everyone" not in r.text and "Bobs" not in r.text and "client street" not in r.text


def test_bad_tokens_same_404(alice, make_client):
    c, h = alice
    old = make_feed(c, h)
    make_feed(c, h)  # the old link is now revoked
    anon = make_client()
    answers = {(r.status_code, r.text) for r in (
        fetch(anon, old),
        anon.get("/api/schedule/feed/nope.ics"),
        anon.get("/api/schedule/feed/" + "a" * 43 + ".ics"),
        anon.get("/api/schedule/feed/" + raw_of(old)),  # without .ics
    )}
    assert answers == {(404, NOT_FOUND)}


def test_revoked_link_stops(alice, make_client):
    c, h = alice
    url = make_feed(c, h)
    c.delete("/api/account/calendar-feed", headers=h)
    r = fetch(make_client(), url)
    assert (r.status_code, r.text) == (404, NOT_FOUND)


def test_disabled_user_gets_404(alice, owner_engine, make_client):
    c, h = alice
    url = make_feed(c, h)
    with owner_engine.begin() as db:
        db.execute(text("UPDATE users SET status = 'disabled' WHERE username = 'alice'"))
    r = fetch(make_client(), url)
    assert (r.status_code, r.text) == (404, NOT_FOUND)


def test_removed_person_loses_event(alice, bob, owner_engine, make_client):
    c, h = alice
    me, other = uid(owner_engine, "alice"), uid(owner_engine, "bob")
    eid = event(c, h, title="Job", people=[me])
    url = make_feed(c, h)
    assert "SUMMARY:Job" in fetch(make_client(), url).text
    r = c.patch(f"/api/schedule/events/{eid}", json={"title": "Job", "start_date": "2026-11-27", "start_time": "09:00",
                                                     "duration_minutes": 60, "people": [other]}, headers=h)
    assert r.status_code == 200, r.text
    assert "SUMMARY:Job" not in fetch(make_client(), url).text


def test_exception_and_cancellation(alice, owner_engine, make_client):
    c, h = alice
    me = uid(owner_engine, "alice")
    base = {"title": "Weekly", "start_date": "2026-11-26", "start_time": "09:00", "duration_minutes": 60,
            "recurrence": WEEKLY_THU, "people": [me]}
    eid = event(c, h, **{k: v for k, v in base.items() if k != "title"}, title="Weekly")
    r = c.patch(f"/api/schedule/events/{eid}", headers=h, json={**base, "title": "Moved", "start_date": "2026-12-04",
                                                                "start_time": "10:00", "scope": "this",
                                                                "occurrence_date": "2026-12-03"})
    assert r.status_code == 200, r.text
    r = c.delete(f"/api/schedule/events/{eid}", params={"scope": "this", "occurrence_date": "2026-12-10"}, headers=h)
    assert r.status_code == 200, r.text
    out = fetch(make_client(), make_feed(c, h)).text
    moved = out.split(f"UID:{eid}-2026-12-03@kmk-entretien.ca\r\n")[1].split("END:VEVENT")[0]
    assert "DTSTART;TZID=America/Toronto:20261204T100000" in moved and "SUMMARY:Moved" in moved
    assert f"UID:{eid}-2026-12-10@" not in out
    assert f"UID:{eid}-2026-12-17@" in out


def test_late_event_ends_same_day(alice, owner_engine, make_client):
    c, h = alice
    event(c, h, title="Late", start_time="23:00", duration_minutes=120, people=[uid(owner_engine, "alice")])
    out = fetch(make_client(), make_feed(c, h)).text
    assert "DTSTART;TZID=America/Toronto:20261127T230000\r\nDTEND;TZID=America/Toronto:20261127T235900" in out


def test_all_day_event(alice, owner_engine, make_client):
    c, h = alice
    event(c, h, title="Holiday", all_day=True, start_time=None, duration_minutes=None, people=[uid(owner_engine, "alice")])
    out = fetch(make_client(), make_feed(c, h)).text
    assert "DTSTART;VALUE=DATE:20261127\r\nDTEND;VALUE=DATE:20261128" in out


def test_window_bounds(alice, owner_engine, make_client):
    c, h = alice
    me = uid(owner_engine, "alice")
    for title, day in [("TooOld", "2026-10-25"), ("Oldest", "2026-10-26"), ("Latest", "2027-11-26"), ("TooFar", "2027-11-27")]:
        event(c, h, title=title, start_date=day, people=[me])
    out = fetch(make_client(), make_feed(c, h)).text
    assert "SUMMARY:Oldest" in out and "SUMMARY:Latest" in out
    assert "TooOld" not in out and "TooFar" not in out


def test_updates_last_used(alice, make_client):
    c, h = alice
    url = make_feed(c, h)
    fetch(make_client(), url)
    assert c.get("/api/account/calendar-feed").json()["last_used_at"] is not None


def test_failures_rate_limited(alice, make_client):
    c, h = alice
    url = make_feed(c, h)
    guesser = make_client(peer="5.5.5.5", rl_ip_max=3)
    for _ in range(3):
        assert guesser.get("/api/schedule/feed/" + "b" * 43 + ".ics").status_code == 404
    assert guesser.get("/api/schedule/feed/" + "b" * 43 + ".ics").status_code == 429
    assert fetch(guesser, url).status_code == 200  # a valid link still works from a limited address (final review)
    assert fetch(make_client(peer="6.6.6.6", rl_ip_max=3), url).status_code == 200


def test_successful_reads_are_not_counted(alice, owner_engine, make_client):
    c, h = alice
    url = make_feed(c, h)
    reader = make_client(peer="7.7.7.7", rl_ip_max=2)
    for _ in range(4):
        assert fetch(reader, url).status_code == 200
    assert sql(owner_engine, "SELECT count(*) FROM login_attempts WHERE kind = 'feed'")[0][0] == 0


# ---- final review fixes ----

import logging  # noqa: E402


def test_access_log_never_carries_the_token(make_client):
    make_client()  # the app installs the filter when it is created
    logger = logging.getLogger("uvicorn.access")
    record = logging.LogRecord("uvicorn.access", logging.INFO, __file__, 1, '%s - "%s %s HTTP/%s" %d',
                               ("1.2.3.4:5", "GET", "/api/schedule/feed/s3cr3tTOKEN.ics?x=1", "1.1", 200), None)
    assert logger.filter(record)
    line = record.getMessage()
    assert "s3cr3tTOKEN" not in line and "/api/schedule/feed/" in line
    other = logging.LogRecord("uvicorn.access", logging.INFO, __file__, 1, '%s - "%s %s HTTP/%s" %d',
                              ("1.2.3.4:5", "GET", "/api/schedule/events?from=1", "1.1", 200), None)
    assert logger.filter(other) and "/api/schedule/events?from=1" in other.getMessage()
    assert sum(1 for f in logger.filters if type(f).__name__ == "FeedPathRedactor") == 1  # not stacked per app


def test_valid_link_served_from_a_limited_address(alice, make_client):
    """A shared fetcher (FamillAI's server, Google's pool) with stale links must not lose the valid ones."""
    c, h = alice
    url = make_feed(c, h)
    fetcher = make_client(peer="8.8.8.8", rl_ip_max=3)
    for _ in range(3):
        fetcher.get("/api/schedule/feed/" + "c" * 43 + ".ics")
    assert fetcher.get("/api/schedule/feed/" + "c" * 43 + ".ics").status_code == 429
    assert fetch(fetcher, url).status_code == 200


def test_dst_days_keep_wall_clock_times(alice, owner_engine, make_client, monkeypatch):
    from app.schedule import service
    monkeypatch.setattr(service, "now_toronto", lambda: datetime(2026, 10, 15, 12, 0))
    c, h = alice
    me = uid(owner_engine, "alice")
    event(c, h, title="FallBack", start_date="2026-11-01", start_time="09:00", people=[me])
    event(c, h, title="SpringFwd", start_date="2027-03-14", start_time="09:00", people=[me])
    out = fetch(make_client(), make_feed(c, h)).text
    assert "DTSTART;TZID=America/Toronto:20261101T090000\r\nDTEND;TZID=America/Toronto:20261101T100000" in out
    assert "DTSTART;TZID=America/Toronto:20270314T090000\r\nDTEND;TZID=America/Toronto:20270314T100000" in out
