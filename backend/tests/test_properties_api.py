import pytest

from helpers import sql
from test_clients_api import add, client_body
from test_quote_arrival import send
from test_schedule_api import create as create_event, session, uid


def prop_body(**kw):
    base = {"name": "Beach house", "kind": "airbnb", "address": "12 chemin de la Plage", "city": "Québec", "listing_url": "https://www.airbnb.com/rooms/1", "access_notes": "Code 4821"}
    base.update(kw)
    return base


def add_prop(c, h, cid, **kw):
    return c.post(f"/api/clients/{cid}/properties", json=prop_body(**kw), headers=h)


@pytest.fixture
def boss(make_client, add_user):
    return session(make_client, add_user, "boss", role="admin")


def test_admin_adds_changes_and_deletes_properties_of_a_client(boss):
    c, h = boss
    cid = add(c, h).json()["client"]["id"]
    r = add_prop(c, h, cid)
    assert r.status_code == 201, r.text
    p = r.json()["property"]
    assert p["client_id"] == cid and p["kind"] == "airbnb" and p["access_notes"] == "Code 4821"
    assert add_prop(c, h, cid, name="Office", kind="commercial", listing_url=None).status_code == 201
    detail = c.get(f"/api/clients/{cid}").json()["client"]
    assert [x["name"] for x in detail["properties"]] == ["Beach house", "Office"]
    r = c.patch(f"/api/properties/{p['id']}", json=prop_body(name="Beach house 2", access_notes=None), headers=h)
    assert r.status_code == 200 and r.json()["property"]["name"] == "Beach house 2" and r.json()["property"]["access_notes"] is None
    assert c.delete(f"/api/properties/{p['id']}", headers=h).status_code == 204
    assert [x["name"] for x in c.get(f"/api/clients/{cid}").json()["client"]["properties"]] == ["Office"]


@pytest.mark.parametrize("bad", [{"name": ""}, {"kind": "villa"}, {"listing_url": "javascript:alert(1)"}, {"listing_url": "not a link"}, {"address": "x" * 300}, {"colour": "red"}])
def test_invalid_properties_are_refused(boss, bad):
    c, h = boss
    cid = add(c, h).json()["client"]["id"]
    assert add_prop(c, h, cid, **bad).status_code == 422


def test_an_event_picks_a_property_of_its_own_client(boss, owner_engine):
    c, h = boss
    a = add(c, h).json()["client"]["id"]
    b = add(c, h, name="Marc Dion").json()["client"]["id"]
    pa = add_prop(c, h, a).json()["property"]["id"]
    pb = add_prop(c, h, b).json()["property"]["id"]
    ok = create_event(c, h, client_id=a, property_id=pa)
    assert ok.status_code == 201 and ok.json()["event"]["property_id"] == pa
    assert create_event(c, h, client_id=a, property_id=pb).status_code == 422  # another client's property
    assert create_event(c, h, property_id=pa).status_code == 422  # a property needs its client
    eid = ok.json()["event"]["id"]
    assert c.delete(f"/api/properties/{pa}", headers=h).status_code == 204  # the event stays, unlinked
    assert c.get(f"/api/schedule/events/{eid}").json()["event"]["property_id"] is None
    assert sql(owner_engine, "SELECT count(*) FROM events")[0][0] == 1


def test_changing_the_client_of_an_event_needs_a_matching_property(boss):
    c, h = boss
    a = add(c, h).json()["client"]["id"]
    b = add(c, h, name="Marc Dion").json()["client"]["id"]
    pa = add_prop(c, h, a).json()["property"]["id"]
    eid = create_event(c, h, client_id=a, property_id=pa).json()["event"]["id"]
    body = {"title": "Visit", "start_date": "2026-11-05", "start_time": "09:00", "duration_minutes": 60, "scope": "all"}
    assert c.patch(f"/api/schedule/events/{eid}", json={**body, "client_id": b, "property_id": pa}, headers=h).status_code == 422
    assert c.patch(f"/api/schedule/events/{eid}", json={**body, "client_id": b}, headers=h).status_code == 200


def test_staff_see_the_properties_with_access_notes_of_a_scheduled_client_only(make_client, add_user, boss, owner_engine):
    c, h = boss
    s, sh = session(make_client, add_user, "zoe")
    a = add(c, h).json()["client"]["id"]
    other = add(c, h, name="Marc Dion").json()["client"]["id"]
    pa = add_prop(c, h, a).json()["property"]["id"]
    add_prop(c, h, other)
    create_event(c, h, client_id=a, property_id=pa, people=[uid(owner_engine, "zoe")])
    got = s.get(f"/api/clients/{a}").json()["client"]
    assert [x["address"] for x in got["properties"]] == ["12 chemin de la Plage"] and got["properties"][0]["access_notes"] == "Code 4821"
    assert s.get(f"/api/clients/{other}").status_code == 404
    assert s.post(f"/api/clients/{a}/properties", json=prop_body(), headers=sh).status_code == 403
    assert s.patch(f"/api/properties/{pa}", json=prop_body(), headers=sh).status_code == 403
    assert s.delete(f"/api/properties/{pa}", headers=sh).status_code == 403


def test_a_client_made_from_a_quote_gets_its_first_property(boss, client):
    c, h = boss
    qid = send(client, listing_url="https://www.airbnb.com/rooms/77")
    r = add(c, h, quote_id=qid)
    assert r.status_code == 201, r.text
    props = c.get(f"/api/clients/{r.json()['client']['id']}").json()["client"]["properties"]
    assert len(props) == 1 and props[0]["kind"] == "airbnb" and props[0]["address"] == "123 rue Saint-Jean, app. 4"
    assert props[0]["listing_url"] == "https://www.airbnb.com/rooms/77" and props[0]["city"] == "Québec"


def test_deleting_a_client_deletes_its_properties(boss, owner_engine):
    c, h = boss
    cid = add(c, h).json()["client"]["id"]
    add_prop(c, h, cid)
    assert c.delete(f"/api/clients/{cid}", headers=h).status_code == 204
    assert sql(owner_engine, "SELECT count(*) FROM properties")[0][0] == 0
