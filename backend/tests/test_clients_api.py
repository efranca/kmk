import pytest

from helpers import ORIGIN, login, sql
from test_quote_arrival import send
from test_schedule_api import create as create_event, session, uid


def client_body(**kw):
    base = {"name": "Chantal Roy", "kind": "airbnb", "contact_name": "Chantal", "email": "Chantal@Example.com", "phone": "418-555-0101", "address": "12 rue Saint-Jean", "city": "Québec", "notes": "Key under the mat"}
    base.update(kw)
    return base


def add(c, h, **kw):
    return c.post("/api/clients", json=client_body(**kw), headers=h)


@pytest.fixture
def boss(make_client, add_user):
    return session(make_client, add_user, "boss", role="admin")


def test_admin_creates_reads_updates_and_deletes_a_client(boss, owner_engine):
    c, h = boss
    r = add(c, h)
    assert r.status_code == 201, r.text
    created = r.json()["client"]
    assert created["name"] == "Chantal Roy" and created["email"] == "chantal@example.com" and created["notes"] == "Key under the mat"
    cid = created["id"]
    assert [x["id"] for x in c.get("/api/clients").json()["clients"]] == [cid]
    assert [x["id"] for x in c.get("/api/clients", params={"q": "chant"}).json()["clients"]] == [cid]
    assert c.get("/api/clients", params={"q": "zzz"}).json()["clients"] == []
    got = c.get(f"/api/clients/{cid}").json()["client"]
    assert got["city"] == "Québec" and got["tasks"] == [] and got["events"] == [] and got["documents"] == [] and got["quotes"] == []
    r = c.patch(f"/api/clients/{cid}", json=client_body(name="Chantal R.", phone=None), headers=h)
    assert r.status_code == 200 and r.json()["client"]["name"] == "Chantal R." and r.json()["client"]["phone"] is None
    assert c.delete(f"/api/clients/{cid}", headers=h).status_code == 204
    assert c.get(f"/api/clients/{cid}").status_code == 404
    actions = [a[0] for a in sql(owner_engine, "SELECT action FROM audit_log WHERE action LIKE 'client_%' ORDER BY id")]
    assert actions == ["client_created", "client_updated", "client_deleted"]


@pytest.mark.parametrize("bad", [{"name": ""}, {"name": "x" * 200}, {"kind": "villa"}, {"email": "nope"}, {"phone": "x" * 80}, {"colour": "red"}])
def test_invalid_clients_are_refused(boss, bad):
    c, h = boss
    assert add(c, h, **bad).status_code == 422


def test_staff_cannot_use_clients_yet(make_client, add_user, boss):
    c, h = boss
    cid = add(c, h).json()["client"]["id"]
    s, sh = session(make_client, add_user, "tom")
    assert s.get("/api/clients").status_code == 403
    assert s.get(f"/api/clients/{cid}").status_code == 403
    assert s.post("/api/clients", json=client_body(), headers=sh).status_code == 403
    assert s.patch(f"/api/clients/{cid}", json=client_body(), headers=sh).status_code == 403
    assert s.delete(f"/api/clients/{cid}", headers=sh).status_code == 403


def test_a_task_an_event_and_a_document_can_point_to_a_client(boss, owner_engine):
    c, h = boss
    cid = add(c, h).json()["client"]["id"]
    t = c.post("/api/tasks", json={"title": "Call", "client_id": cid}, headers=h)
    assert t.status_code == 201 and t.json()["task"]["client_id"] == cid
    e = create_event(c, h, client_id=cid)
    assert e.status_code == 201 and e.json()["event"]["client_id"] == cid
    d = c.post("/api/documents", json={"title": "Lease", "client_id": cid}, headers=h)
    assert d.status_code == 201 and d.json()["document"]["client_id"] == cid
    sql(owner_engine, "UPDATE documents SET size_bytes = 1, file_name = 'a.pdf', content_type = 'application/pdf' WHERE size_bytes IS NULL")  # a document counts once its file is stored
    detail = c.get(f"/api/clients/{cid}").json()["client"]
    assert [x["title"] for x in detail["tasks"]] == ["Call"] and [x["title"] for x in detail["events"]] == ["Visit"]
    assert [x["title"] for x in detail["documents"]] == ["Lease"]
    assert c.post("/api/tasks", json={"title": "x", "client_id": 9999}, headers=h).status_code == 422
    assert create_event(c, h, client_id=9999).status_code == 422
    assert c.delete(f"/api/clients/{cid}", headers=h).status_code == 204  # the links are cleared, nothing else goes
    assert c.get("/api/tasks").json()["tasks"][0]["client_id"] is None
    assert sql(owner_engine, "SELECT count(*) FROM events WHERE client_id IS NOT NULL")[0][0] == 0


def test_a_quote_can_be_linked_to_a_client_and_creates_one(boss, client, owner_engine):
    c, h = boss
    qid = send(client)
    r = add(c, h, quote_id=qid)
    assert r.status_code == 201, r.text
    cid = r.json()["client"]["id"]
    q = c.get(f"/api/quotes/{qid}").json()["quote"]
    assert q["client"] == {"id": cid, "name": "Chantal Roy"}
    detail = c.get(f"/api/clients/{cid}").json()["client"]
    assert [x["id"] for x in detail["quotes"]] == [qid]
    other = add(c, h, name="Someone else").json()["client"]["id"]
    assert c.patch(f"/api/quotes/{qid}", json={"client_id": other}, headers=h).json()["quote"]["client"]["id"] == other
    assert c.patch(f"/api/quotes/{qid}", json={"client_id": None}, headers=h).json()["quote"]["client"] is None
    assert add(c, h, quote_id=99999).status_code == 422
