import pytest

from helpers import sql
from test_clients_api import add, client_body
from test_schedule_api import create as create_event, session, uid


@pytest.fixture
def world(make_client, add_user, owner_engine):
    add_user("tom", "tom@example.com")
    boss = session(make_client, add_user, "boss", role="admin")
    staff = session(make_client, add_user, "zoe")
    c, h = boss
    a = add(c, h, name="Chantal Roy").json()["client"]["id"]
    b = add(c, h, name="Marc Dion", notes="Private").json()["client"]["id"]
    return dict(boss=boss, staff=staff, a=a, b=b, zoe=uid(owner_engine, "zoe"), tom=uid(owner_engine, "tom"))


def test_staff_see_a_client_only_while_scheduled_for_it(world):
    c, h = world["boss"]
    s, _ = world["staff"]
    eid = create_event(c, h, client_id=world["a"], people=[world["zoe"]]).json()["event"]["id"]
    create_event(c, h, title="Other", client_id=world["b"], people=[world["tom"]])
    create_event(c, h, title="For everyone", client_id=world["b"])  # no listed people: it does not open the client to anyone
    listed = s.get("/api/clients").json()["clients"]
    assert [x["name"] for x in listed] == ["Chantal Roy"]
    assert "notes" not in listed[0] and listed[0]["address"] == "12 rue Saint-Jean" and listed[0]["phone"] == "418-555-0101"
    assert s.get(f"/api/clients/{world['b']}").status_code == 404
    other = {**{"title": "Visit", "start_date": "2026-11-05", "start_time": "09:00", "duration_minutes": 60}, "client_id": world["a"], "people": [world["tom"]], "scope": "all"}
    assert c.patch(f"/api/schedule/events/{eid}", json=other, headers=h).status_code == 200  # Zoe is taken off the event
    assert s.get("/api/clients").json() == {"clients": []}
    assert s.get(f"/api/clients/{world['a']}").status_code == 404


def test_the_staff_page_has_the_details_and_their_own_events_only(world, owner_engine):
    c, h = world["boss"]
    s, _ = world["staff"]
    create_event(c, h, title="Deep clean", client_id=world["a"], people=[world["zoe"]])
    create_event(c, h, title="Someone else's visit", client_id=world["a"], people=[world["tom"]])
    c.post("/api/tasks", json={"title": "Call", "client_id": world["a"]}, headers=h)
    c.post("/api/documents", json={"title": "Lease", "client_id": world["a"]}, headers=h)
    sql(owner_engine, "UPDATE documents SET size_bytes = 1, file_name = 'a.pdf', content_type = 'application/pdf'")
    got = s.get(f"/api/clients/{world['a']}").json()["client"]
    assert [e["title"] for e in got["events"]] == ["Deep clean"]
    for hidden in ("notes", "tasks", "documents", "quotes", "email_notes"):
        assert hidden not in got
    assert got["email"] == "chantal@example.com" and got["city"] == "Québec"
    admin = c.get(f"/api/clients/{world['a']}").json()["client"]
    assert admin["notes"] and len(admin["events"]) == 2 and len(admin["documents"]) == 1  # administrators still see everything


def test_staff_cannot_change_clients_and_may_link_only_the_ones_they_see(world):
    c, h = world["boss"]
    s, sh = world["staff"]
    create_event(c, h, client_id=world["a"], people=[world["zoe"]])
    assert s.patch(f"/api/clients/{world['a']}", json=client_body(), headers=sh).status_code == 403
    assert s.delete(f"/api/clients/{world['a']}", headers=sh).status_code == 403
    assert s.post("/api/tasks", json={"title": "Mine", "client_id": world["a"]}, headers=sh).status_code == 201
    assert s.post("/api/tasks", json={"title": "Not mine", "client_id": world["b"]}, headers=sh).status_code == 422


def test_my_clients_is_a_dashboard_switch(make_client, add_user):
    c, h = session(make_client, add_user, "zoe")
    assert c.get("/api/auth/me").json()["preferences"]["dashboard_widgets"]["my_clients"] is True
    r = c.patch("/api/me/preferences", json={"dashboard_widgets": {"my_clients": False}}, headers=h)
    assert r.json()["preferences"]["dashboard_widgets"]["my_clients"] is False
