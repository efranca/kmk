from datetime import datetime

import pytest

from helpers import ORIGIN, login, sql

WEEKLY_THU = {"freq": "weekly", "interval": 1, "weekdays": ["THU"], "month_day": None, "nth_weekdays": []}


def session(make_client, add_user, username, role="user"):
    add_user(username, f"{username}@example.com", role=role)
    c = make_client()
    token = login(c, username).json()["csrf_token"]
    return c, {**ORIGIN, "X-CSRF-Token": token}


def uid(owner_engine, username):
    return sql(owner_engine, "SELECT id FROM users WHERE username = :u", u=username)[0][0]


def create(c, h, **kw):
    base = {"title": "Visit", "start_date": "2026-11-05", "start_time": "09:00", "duration_minutes": 60,
            "reminders": [{"amount": 2, "unit": "hours"}]}
    base.update(kw)
    r = c.post("/api/schedule/events", json=base, headers=h)
    assert r.status_code == 201, r.text
    return r.json()["event"]["id"]


def due(c):
    r = c.get("/api/schedule/reminders/due")
    assert r.status_code == 200, r.text
    return r.json()["reminders"]


@pytest.fixture
def clock(monkeypatch):
    def at(moment: str):
        monkeypatch.setattr("app.schedule.service.now_toronto", lambda: datetime.fromisoformat(moment))

    return at


@pytest.fixture
def alice(make_client, add_user):
    return session(make_client, add_user, "alice", role="admin")  # admins can make events for anyone


def test_due_when_two_hours_before(alice, clock):
    c, h = alice
    eid = create(c, h)
    clock("2026-11-05T07:30")
    assert due(c) == [{
        "event_id": eid, "occurrence_date": "2026-11-05", "title": "Visit", "start_date": "2026-11-05",
        "start_time": "09:00", "all_day": False, "remind_at": "2026-11-05T07:00",
    }]


def test_not_due_earlier(alice, clock):
    c, h = alice
    create(c, h)
    clock("2026-11-05T06:59")
    assert due(c) == []


def test_not_due_once_the_occurrence_started_over_a_day_ago(alice, clock):
    c, h = alice
    create(c, h)
    clock("2026-11-06T09:01")
    assert due(c) == []
    clock("2026-11-06T08:59")
    assert len(due(c)) == 1


def test_everyone_event_reminds_every_user(make_client, add_user, clock):
    c, h = session(make_client, add_user, "alice", role="admin")
    bc, _ = session(make_client, add_user, "bob")
    create(c, h)
    clock("2026-11-05T08:00")
    assert len(due(c)) == 1 and len(due(bc)) == 1


def test_other_users_event_not_listed(make_client, add_user, owner_engine, clock):
    c, h = session(make_client, add_user, "alice", role="admin")
    bc, _ = session(make_client, add_user, "bob")
    create(c, h, people=[uid(owner_engine, "alice")])
    clock("2026-11-05T08:00")
    assert len(due(c)) == 1 and due(bc) == []


def test_dismiss_hides_only_for_that_user(make_client, add_user, clock):
    c, h = session(make_client, add_user, "alice", role="admin")
    bc, _ = session(make_client, add_user, "bob")
    eid = create(c, h)
    clock("2026-11-05T08:00")
    r = c.post("/api/schedule/reminders/dismiss", json={"event_id": eid, "occurrence_date": "2026-11-05"}, headers=h)
    assert r.status_code == 204
    assert due(c) == [] and len(due(bc)) == 1


def test_dismiss_is_idempotent(alice, clock):
    c, h = alice
    eid = create(c, h)
    for _ in range(2):
        r = c.post("/api/schedule/reminders/dismiss", json={"event_id": eid, "occurrence_date": "2026-11-05"}, headers=h)
        assert r.status_code == 204


def test_dismiss_unknown_event_is_404(alice):
    c, h = alice
    r = c.post("/api/schedule/reminders/dismiss", json={"event_id": 9999, "occurrence_date": "2026-11-05"}, headers=h)
    assert (r.status_code, r.json()) == (404, {"error": "not_found"})


def test_all_day_reminder_uses_midnight_of_the_start_date(alice, clock):
    c, h = alice
    create(c, h, all_day=True, start_time=None, duration_minutes=None, reminders=[{"amount": 1, "unit": "days"}])
    clock("2026-11-03T23:59")
    assert due(c) == []
    clock("2026-11-04T00:00")
    reminder = due(c)[0]
    assert (reminder["remind_at"], reminder["all_day"], reminder["start_time"]) == ("2026-11-04T00:00", True, None)


def test_repeating_event_reminds_for_the_next_occurrence_only(alice, clock):
    c, h = alice
    create(c, h, recurrence=WEEKLY_THU, reminders=[{"amount": 1, "unit": "days"}])
    clock("2026-11-11T10:00")  # Wednesday: the Thursday 11-12 occurrence is due, 11-19 is not yet
    assert [r["occurrence_date"] for r in due(c)] == ["2026-11-12"]


def test_a_long_lead_reaches_far_occurrences(alice, clock):
    c, h = alice
    create(c, h, start_date="2027-01-20", reminders=[{"amount": 8, "unit": "weeks"}])
    clock("2026-11-30T12:00")
    assert [r["occurrence_date"] for r in due(c)] == ["2027-01-20"]
