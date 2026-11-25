from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from test_quotes_public_api import hdr, qbody, start, submit
from helpers import sql

TORONTO = ZoneInfo("America/Toronto")


@pytest.fixture
def team(add_user):
    add_user("boss", "boss@example.com", role="superadmin")
    add_user("ana", "ana@example.com", role="admin")
    add_user("gone", "gone@example.com", role="admin", status="disabled")
    add_user("tom", "tom@example.com", role="user")


def send(client, **kw):
    a = start(client, **kw).json()
    r = submit(client, a["id"], a["token"])
    assert r.status_code == 200, r.text
    return a["id"]


def users(owner_engine):
    return {r[1]: r[0] for r in sql(owner_engine, "SELECT id, username FROM users")}


def test_submit_creates_one_task_for_active_admins_only(client, owner_engine, team):
    qid = send(client)
    ids = users(owner_engine)
    task = sql(owner_engine, "SELECT id, title, description, icon, due_date, created_by, updated_by, category_id FROM tasks")
    assert len(task) == 1
    tid, title, description, icon, due, created_by, updated_by, category = task[0]
    assert title == f"Quote D-{qid:04d} · Airbnb · Québec" and icon == "📋" and created_by is None and updated_by is None
    assert description.endswith(f"/quotes/{qid}")
    deadline = sql(owner_engine, "SELECT deadline_at FROM quotes")[0][0]
    assert due == deadline.astimezone(TORONTO).date()
    people = {r[0] for r in sql(owner_engine, "SELECT user_id FROM task_people WHERE task_id = :t", t=tid)}
    assert people == {ids["boss"], ids["ana"]}
    assert sql(owner_engine, "SELECT task_id FROM quotes")[0][0] == tid


def test_submit_creates_the_deadline_event_with_a_reminder(client, owner_engine, team):
    qid = send(client, kind="commercial", property="office", frequency="weekly", message="Bureau", bedrooms=None, bathrooms=None)
    ev = sql(owner_engine, "SELECT id, title, notes, start_date, start_time, duration_minutes, created_by, all_day FROM events")
    assert len(ev) == 1
    eid, title, notes, day, at, minutes, created_by, all_day = ev[0]
    assert title == f"Quote deadline D-{qid:04d} · Commercial · Québec" and created_by is None and not all_day and minutes == 30
    local = sql(owner_engine, "SELECT deadline_at FROM quotes")[0][0].astimezone(TORONTO)
    assert (day, at.hour, at.minute) == (local.date(), local.hour, local.minute) and notes.endswith(f"/quotes/{qid}")
    assert [tuple(r) for r in sql(owner_engine, "SELECT amount, unit FROM event_reminders WHERE event_id = :e", e=eid)] == [(2, "hours")]
    ids = users(owner_engine)
    assert {r[0] for r in sql(owner_engine, "SELECT user_id FROM event_people WHERE event_id = :e", e=eid)} == {ids["boss"], ids["ana"]}
    assert sql(owner_engine, "SELECT event_id FROM quotes")[0][0] == eid


def test_titles_and_notes_carry_no_customer_data(client, owner_engine, team):
    send(client, message="Mon texte privé")
    text = " ".join(str(v) for row in sql(owner_engine, "SELECT tasks.title, tasks.description, events.title, events.notes FROM tasks, events") for v in row if v)
    for secret in ("Maria", "maria@example.com", "418-555-0100", "privé"):
        assert secret not in text


def test_notification_email_goes_to_the_setting(client, owner_engine, team, outbox):
    sql(owner_engine, "INSERT INTO app_settings (key, value) VALUES ('quote_notify_email', 'team@gmail.com')")
    qid = send(client)
    assert [(m.to, m.subject) for m in outbox] == [("team@gmail.com", f"Nouvelle demande de soumission D-{qid:04d}")]


def test_no_notification_email_without_the_setting(client, team, outbox):
    send(client)
    assert outbox == []


def test_a_failing_email_or_push_does_not_fail_the_submit(client, owner_engine, team, monkeypatch):
    import app.emails.sender as sender

    sql(owner_engine, "INSERT INTO app_settings (key, value) VALUES ('quote_notify_email', 'team@gmail.com')")

    def boom(*a, **k):
        raise RuntimeError("provider down")

    monkeypatch.setattr(sender, "send_email", boom)
    send(client)
    assert sql(owner_engine, "SELECT status FROM quotes")[0][0] == "new"
    assert sql(owner_engine, "SELECT count(*) FROM tasks")[0][0] == 1


def test_double_submit_creates_one_task_and_one_event(client, owner_engine, team):
    a = start(client).json()
    submit(client, a["id"], a["token"])
    submit(client, a["id"], a["token"])
    assert sql(owner_engine, "SELECT (SELECT count(*) FROM tasks), (SELECT count(*) FROM events)")[0] == (1, 1)


def test_deleted_quotes_category_still_works(client, owner_engine, team):
    sql(owner_engine, "INSERT INTO task_categories (name) VALUES ('Quotes')")
    cat = sql(owner_engine, "SELECT id FROM task_categories")[0][0]
    send(client)
    assert sql(owner_engine, "SELECT category_id FROM tasks")[0][0] == cat
    sql(owner_engine, "DELETE FROM task_categories")
    send(client)
    assert [r[0] for r in sql(owner_engine, "SELECT category_id FROM tasks ORDER BY id")] == [None, None]
