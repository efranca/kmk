import pytest

from helpers import ORIGIN, sql
from test_clients_api import add as add_client
from test_schedule_api import session


def body(**kw):
    base = {"name": "Chantal Roy", "phone": "418-555-0101", "kind": "airbnb", "city": "Québec", "address": "12 rue Saint-Jean", "property": "house", "frequency": "weekly", "message": "Called on Tuesday: wants weekly turnover."}
    base.update(kw)
    return base


@pytest.fixture
def boss(make_client, add_user):
    return session(make_client, add_user, "boss", role="admin")


def test_an_admin_enters_a_quote_taken_by_phone(boss, owner_engine, outbox):
    c, h = boss
    r = c.post("/api/quotes", json=body(), headers=h)
    assert r.status_code == 201, r.text
    q = r.json()["quote"]
    assert q["status"] == "new" and q["source"] == "manual" and q["email"] == "" and q["name"] == "Chantal Roy"
    assert q["details"]["city"] == "Québec" and q["details"]["address"] == "12 rue Saint-Jean" and q["message"].startswith("Called on Tuesday")
    assert q["created_by"]["name"] and q["deadline_at"] and q["reference"].startswith("D-")
    listed = c.get("/api/quotes").json()
    assert [x["id"] for x in listed["quotes"]] == [q["id"]] and listed["counts"]["new"] == 1
    assert sql(owner_engine, "SELECT count(*) FROM tasks")[0][0] == 0 and sql(owner_engine, "SELECT count(*) FROM events")[0][0] == 0
    assert outbox == []  # the person entering it is already handling it
    assert sql(owner_engine, "SELECT action FROM audit_log WHERE action = 'quote_entered'")


def test_email_and_client_are_optional_but_checked_when_given(boss):
    c, h = boss
    cid = add_client(c, h).json()["client"]["id"]
    ok = c.post("/api/quotes", json=body(email="Chantal@Example.com", client_id=cid), headers=h)
    assert ok.status_code == 201 and ok.json()["quote"]["email"] == "chantal@example.com" and ok.json()["quote"]["client"]["id"] == cid
    assert c.post("/api/quotes", json=body(client_id=9999), headers=h).status_code == 422
    for bad in ({"email": "nope"}, {"name": ""}, {"phone": "abc"}, {"kind": "villa"}, {"property": "castle"}, {"colour": "red"}, {"locale": "de"}):
        assert c.post("/api/quotes", json=body(**bad), headers=h).status_code == 422, bad
    minimal = c.post("/api/quotes", json={"name": "Marc", "phone": "514-555-0000", "kind": "commercial"}, headers=h)
    assert minimal.status_code == 201 and minimal.json()["quote"]["details"].get("city", "") == ""


def test_only_admins_may_enter_quotes(make_client, add_user):
    anon = make_client()
    assert anon.post("/api/quotes", json=body(), headers=ORIGIN).status_code == 401
    s, sh = session(make_client, add_user, "tom")
    assert s.post("/api/quotes", json=body(), headers=sh).status_code == 403


def test_a_quote_without_an_email_cannot_be_answered_by_email_but_can_log_a_reply(boss):
    c, h = boss
    qid = c.post("/api/quotes", json=body(), headers=h).json()["quote"]["id"]
    out = c.post(f"/api/quotes/{qid}/messages", json={"direction": "out", "subject": "Re", "body": "Hello"}, headers=h)
    assert out.status_code == 422 and out.json()["error"] == "no_email"
    logged = c.post(f"/api/quotes/{qid}/messages", json={"direction": "in", "body": "Phone call: she accepts."}, headers=h)
    assert logged.status_code == 201
    assert c.get(f"/api/quotes/{qid}").json()["quote"]["status"] == "customer_replied"
