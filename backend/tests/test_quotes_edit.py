import pytest

from helpers import ORIGIN, sql
from test_quotes_api import new_quote, session
from test_quotes_manual import body


@pytest.fixture
def boss(make_client, add_user):
    return session(make_client, add_user, "boss", "admin")


def make_manual(c, h, **kw):
    r = c.post("/api/quotes", json=body(**kw), headers=h)
    assert r.status_code == 201, r.text
    return r.json()["quote"]


def edit(c, h, qid, **kw):
    return c.put(f"/api/quotes/{qid}/request", json=body(**kw), headers=h)


def test_edit_a_manual_quote(boss):
    c, h = boss
    q = c.post("/api/quotes", json={"name": "Chantal", "phone": "418-555-0101", "kind": "airbnb"}, headers=h).json()["quote"]
    r = edit(c, h, q["id"], name="Chantal R.", email="Chantal@Example.com", address="12 rue X", message="New text")
    assert r.status_code == 200, r.text
    got = r.json()["quote"]
    assert (got["id"], got["status"], got["reference"]) == (q["id"], q["status"], q["reference"])
    assert got["name"] == "Chantal R." and got["email"] == "chantal@example.com" and got["message"] == "New text"
    assert got["details"]["address"] == "12 rue X"
    assert c.get(f"/api/quotes/{q['id']}").json()["quote"]["name"] == "Chantal R."


def test_edit_a_web_quote_keeps_its_description_and_unknown_details(boss, client, owner_engine):
    c, h = boss
    qid = new_quote(client)["id"]
    sql(owner_engine, "UPDATE quotes SET details = details || '{\"extra_key\": \"kept\"}'::jsonb WHERE id = :i", i=qid)
    before = c.get(f"/api/quotes/{qid}").json()["quote"]
    sent = {"name": before["name"], "phone": before["phone"], "kind": before["kind"], "city": "Lévis", "address": "9 rue Neuve", "property": before["details"]["property"], "frequency": before["details"]["frequency"]}
    r = c.put(f"/api/quotes/{qid}/request", json=sent, headers=h)
    assert r.status_code == 200, r.text
    got = r.json()["quote"]
    assert got["message"] == before["message"] and got["details"]["extra_key"] == "kept" and got["details"]["city"] == "Lévis"
    different = c.put(f"/api/quotes/{qid}/request", json={**sent, "message": "I changed what the customer wrote"}, headers=h)
    assert (different.status_code, different.json()) == (422, {"error": "message_locked"})
    same = c.put(f"/api/quotes/{qid}/request", json={**sent, "message": before["message"]}, headers=h)
    assert same.status_code == 200


@pytest.mark.parametrize("bad", [{"phone": "abc"}, {"email": "nope"}, {"property": "castle"}, {"kind": "commercial", "bedrooms": 2}, {"colour": "red"}, {"client_id": 1}])
def test_edit_refuses_what_the_manual_form_refuses(boss, bad):
    c, h = boss
    q = make_manual(c, h)
    assert edit(c, h, q["id"], **bad).status_code == 422
    assert c.get(f"/api/quotes/{q['id']}").json()["quote"]["phone"] == "418-555-0101"


def test_a_type_change_with_leftovers_is_refused(boss):
    c, h = boss
    q = make_manual(c, h, bedrooms=2, listing_url="https://www.airbnb.com/rooms/1")
    r = edit(c, h, q["id"], kind="commercial", property="office", frequency="weekly", bedrooms=2)
    assert r.status_code == 422
    assert c.get(f"/api/quotes/{q['id']}").json()["quote"]["kind"] == "airbnb"
    ok = edit(c, h, q["id"], kind="commercial", property="office", frequency="weekly")  # the form no longer sends the Airbnb-only fields
    assert ok.status_code == 200 and "bedrooms" not in ok.json()["quote"]["details"] and "listing_url" not in ok.json()["quote"]["details"]


def test_clearing_the_email_stores_an_empty_one(boss):
    c, h = boss
    q = make_manual(c, h, email="a@example.com")
    r = edit(c, h, q["id"], email=None)
    assert r.status_code == 200 and r.json()["quote"]["email"] == ""


def test_audit_names_only_the_changed_fields(boss, owner_engine):
    c, h = boss
    q = make_manual(c, h)
    assert edit(c, h, q["id"], city="Lévis", phone="514-555-0000").status_code == 200
    rows = sql(owner_engine, "SELECT details FROM audit_log WHERE action = 'quote_edited'")
    assert len(rows) == 1 and sorted(rows[0][0]["fields"]) == ["city", "phone"] and rows[0][0]["quote_id"] == q["id"]
    assert "514-555-0000" not in str(rows[0][0]) and "Lévis" not in str(rows[0][0])
    assert edit(c, h, q["id"], city="Lévis", phone="514-555-0000").status_code == 200  # nothing changed
    assert len(sql(owner_engine, "SELECT 1 FROM audit_log WHERE action = 'quote_edited'")) == 1


def test_only_admins_edit(boss, make_client, add_user):
    c, h = boss
    q = make_manual(c, h)
    anon = make_client()
    assert anon.put(f"/api/quotes/{q['id']}/request", json=body(), headers=ORIGIN).status_code == 401
    s, sh = session(make_client, add_user, "tom", "user")
    assert s.put(f"/api/quotes/{q['id']}/request", json=body(), headers=sh).status_code == 403
    assert edit(c, h, 99999).status_code == 404
