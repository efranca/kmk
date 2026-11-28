import pytest

from test_clients_api import add
from test_properties_api import add_prop, prop_body
from test_schedule_api import session


@pytest.fixture
def boss(make_client, add_user):
    return session(make_client, add_user, "boss", role="admin")


def put(c, h, pid, rooms):
    return c.put(f"/api/properties/{pid}/rooms", json={"rooms": rooms}, headers=h)


def setup(c, h, **kw):
    cid = add(c, h).json()["client"]["id"]
    return cid, add_prop(c, h, cid, **kw).json()["property"]["id"]


def rooms_of(c, cid):
    return c.get(f"/api/clients/{cid}").json()["client"]["properties"][0]["rooms"]


def test_admin_sets_rooms_in_order_and_keeps_ids(boss):
    c, h = boss
    cid, pid = setup(c, h)
    r = put(c, h, pid, [{"id": None, "name": "Kitchen"}, {"id": None, "name": "Bedroom"}, {"id": None, "name": "Bath"}])
    assert r.status_code == 200, r.text
    first = r.json()["rooms"]
    assert [x["name"] for x in first] == ["Kitchen", "Bedroom", "Bath"]
    r = put(c, h, pid, [{"id": first[2]["id"], "name": "Bathroom"}, {"id": first[1]["id"], "name": "Bedroom"}, {"id": None, "name": "Hall"}])
    assert r.status_code == 200, r.text
    second = r.json()["rooms"]
    assert [x["name"] for x in second] == ["Bathroom", "Bedroom", "Hall"]
    assert second[0]["id"] == first[2]["id"] and second[1]["id"] == first[1]["id"]
    assert rooms_of(c, cid) == second
    assert put(c, h, pid, []).json()["rooms"] == []


def test_rooms_and_photos_required_come_with_the_property(boss):
    c, h = boss
    cid, pid = setup(c, h)
    put(c, h, pid, [{"id": None, "name": "Kitchen"}])
    p = c.get(f"/api/clients/{cid}").json()["client"]["properties"][0]
    assert p["photos_required"] is False and [x["name"] for x in p["rooms"]] == ["Kitchen"]
    assert add_prop(c, h, cid).json()["property"]["rooms"] == []
    assert c.patch(f"/api/properties/{pid}", json=prop_body(), headers=h).json()["property"]["rooms"][0]["name"] == "Kitchen"


def test_staff_cannot_change_rooms(boss, make_client, add_user):
    c, h = boss
    _, pid = setup(c, h)
    sc, sh = session(make_client, add_user, "staffer")
    assert put(sc, sh, pid, [{"id": None, "name": "Kitchen"}]).status_code == 403


def test_bad_rooms_are_refused(boss):
    c, h = boss
    cid, pid = setup(c, h)
    _, other = setup(c, h)
    foreign = put(c, h, other, [{"id": None, "name": "Attic"}]).json()["rooms"][0]["id"]
    new = {"id": None, "name": "x"}
    for bad in ([{"id": None, "name": ""}], [{"id": None, "name": "   "}], [{"id": None, "name": "x" * 61}], [new] * 31, [{"id": foreign, "name": "Attic"}], [{"id": 99999999, "name": "A"}]):
        assert put(c, h, pid, bad).status_code == 422, bad
    kept = put(c, h, pid, [{"id": None, "name": "A"}]).json()["rooms"][0]["id"]
    assert put(c, h, pid, [{"id": kept, "name": "A"}, {"id": kept, "name": "B"}]).status_code == 422
    assert put(c, h, 99999999, []).status_code == 404


def test_photos_required_is_saved(boss):
    c, h = boss
    cid, pid = setup(c, h)
    r = c.patch(f"/api/properties/{pid}", json=prop_body(photos_required=True), headers=h)
    assert r.status_code == 200 and r.json()["property"]["photos_required"] is True
    assert c.get(f"/api/clients/{cid}").json()["client"]["properties"][0]["photos_required"] is True


def test_every_property_payload_is_given_its_rooms():
    """`rooms` has no default: a caller that forgets it would show an empty room list after a save."""
    import inspect

    from app.clients.service import property_payload

    params = inspect.signature(property_payload).parameters
    assert params["rooms"].default is inspect.Parameter.empty and params["actor"].default is inspect.Parameter.empty
