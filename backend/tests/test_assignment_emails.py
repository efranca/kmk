from helpers import sql
from test_schedule_api import body, create, session, uid
from app.config import get_settings


def prefs(owner_engine, username, **p):
    import json
    sql(owner_engine, "UPDATE users SET preferences = :p WHERE username = :u", p=json.dumps(p), u=username)


def test_a_person_added_to_an_event_gets_an_email_in_their_language(make_client, add_user, owner_engine, outbox):
    add_user("ana", "ana@example.com", locale="pt-BR")
    add_user("tom", "tom@example.com")  # not on the event
    c, h = session(make_client, add_user, "boss", role="admin")
    r = create(c, h, title="Limpeza pos obra", start_date="2026-12-04", start_time="10:00", people=[uid(owner_engine, "ana")])
    assert r.status_code == 201, r.text
    assert [m.to for m in outbox] == ["ana@example.com"]
    m = outbox[0]
    assert "Limpeza pos obra" in m.subject and "2026-12-04" in m.text and "10:00" in m.text
    assert "/schedule?view=day&date=2026-12-04" in m.text and "/schedule?view=day&amp;date=2026-12-04" in m.html
    assert "Você foi" in m.text  # Portuguese


def test_the_person_who_made_the_assignment_gets_nothing_and_nor_does_an_event_for_everyone(make_client, add_user, owner_engine, outbox):
    c, h = session(make_client, add_user, "boss", role="admin")
    assert create(c, h, people=[uid(owner_engine, "boss")]).status_code == 201
    assert create(c, h).status_code == 201
    assert outbox == []


def test_only_newly_added_people_are_told_on_an_edit(make_client, add_user, owner_engine, outbox):
    add_user("ana", "ana@example.com")
    add_user("bea", "bea@example.com")
    c, h = session(make_client, add_user, "boss", role="admin")
    ana, bea = uid(owner_engine, "ana"), uid(owner_engine, "bea")
    eid = create(c, h, people=[ana]).json()["event"]["id"]
    outbox.clear()
    r = c.patch(f"/api/schedule/events/{eid}", json=body(people=[ana, bea], scope="all"), headers=h)
    assert r.status_code == 200, r.text
    assert [m.to for m in outbox] == ["bea@example.com"]
    outbox.clear()
    c.patch(f"/api/schedule/events/{eid}", json=body(title="Renamed", people=[ana, bea], scope="all"), headers=h)
    assert outbox == []


def test_the_person_can_switch_it_off(make_client, add_user, owner_engine, outbox):
    add_user("ana", "ana@example.com")
    add_user("off", "off@example.com")
    prefs(owner_engine, "off", notify_assigned=False)
    c, h = session(make_client, add_user, "boss", role="admin")
    ids = [uid(owner_engine, n) for n in ("ana", "off")]
    create(c, h, people=ids)
    assert [m.to for m in outbox] == ["ana@example.com"]


def test_the_preference_is_on_by_default_and_closed(make_client, add_user):
    c, h = session(make_client, add_user, "ana")
    assert c.get("/api/auth/me").json()["preferences"]["notify_assigned"] is True
    assert c.patch("/api/me/preferences", json={"notify_assigned": False}, headers=h).json()["preferences"]["notify_assigned"] is False
    assert c.patch("/api/me/preferences", json={"notify_assigned": "no"}, headers=h).status_code == 422
