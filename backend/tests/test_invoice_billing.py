from datetime import date

import pytest
from sqlalchemy.orm import Session

from app.invoices.billing import billable, default_description
from helpers import sql
from test_clients_api import add
from test_properties_api import add_prop
from test_schedule_api import WEEKLY_THU, body, create as create_event, session

NOV = dict(from_=date(2025, 11, 1), to=date(2025, 11, 30))
LATER = date(2026, 11, 27)


@pytest.fixture
def boss(make_client, add_user):
    return session(make_client, add_user, "boss", role="admin")


def weekly_for(c, h, cid, pid=None, **kw):
    """A Thursday series starting 2025-11-06 (the 6th, 13th, 20th, 27th of November 2025)."""
    kw.setdefault("title", "Cleaning")
    return create_event(c, h, client_id=cid, property_id=pid, recurrence=WEEKLY_THU, start_date="2025-11-06", **kw).json()["event"]["id"]


def priced_property(c, h, cid, price="120.00", name="Beach house"):
    r = add_prop(c, h, cid, name=name, visit_price=price)
    assert r.status_code == 201, r.text
    return r.json()["property"]["id"]


def find(owner_engine, cid, today=LATER, **window):
    with Session(owner_engine) as db:
        return billable(db, cid, window.get("from_", NOV["from_"]), window.get("to", NOV["to"]), today)


def test_lists_past_occurrences_with_the_property_price(boss, owner_engine):
    c, h = boss
    cid = add(c, h).json()["client"]["id"]
    pid = priced_property(c, h, cid)
    eid = weekly_for(c, h, cid, pid)
    items = find(owner_engine, cid)
    assert [i["date"] for i in items] == ["2025-11-06", "2025-11-13", "2025-11-20", "2025-11-27"]
    assert all(i["price"] == "120.00" and i["event_id"] == eid and i["property_id"] == pid for i in items)
    assert items[0]["occurrence_date"] == "2025-11-06" and items[0]["property_name"] == "Beach house" and items[0]["title"] == "Cleaning"
    assert items[0]["description"] == "Entretien ménager - Beach house - 06/11/2025"


def test_future_and_other_clients_are_left_out(boss, owner_engine):
    c, h = boss
    a = add(c, h).json()["client"]["id"]
    b = add(c, h, name="Marc Dion").json()["client"]["id"]
    weekly_for(c, h, a, priced_property(c, h, a))
    weekly_for(c, h, b, priced_property(c, h, b, name="Office"), title="Other")
    assert [i["date"] for i in find(owner_engine, a, today=date(2025, 11, 15))] == ["2025-11-06", "2025-11-13"]
    assert {i["title"] for i in find(owner_engine, a)} == {"Cleaning"}
    assert find(owner_engine, a, today=date(2025, 10, 1)) == []  # nothing is past yet


def test_moved_and_cancelled_occurrences(boss, owner_engine):
    c, h = boss
    cid = add(c, h).json()["client"]["id"]
    pid = priced_property(c, h, cid)
    eid = weekly_for(c, h, cid, pid)
    assert c.delete(f"/api/schedule/events/{eid}", params={"scope": "this", "occurrence_date": "2025-11-13"}, headers=h).status_code in (200, 204)
    moved = body(recurrence=WEEKLY_THU, start_date="2025-11-28", start_time="09:00", title="Cleaning", client_id=cid, property_id=pid, scope="this", occurrence_date="2025-11-20")
    assert c.patch(f"/api/schedule/events/{eid}", json=moved, headers=h).status_code == 200
    before = find(owner_engine, cid, today=date(2025, 11, 27))
    assert [(i["occurrence_date"], i["date"]) for i in before] == [("2025-11-06", "2025-11-06"), ("2025-11-27", "2025-11-27")]
    after = find(owner_engine, cid, today=date(2025, 11, 30))
    assert [(i["occurrence_date"], i["date"]) for i in after] == [("2025-11-06", "2025-11-06"), ("2025-11-27", "2025-11-27"), ("2025-11-20", "2025-11-28")]


def test_event_without_property_has_no_price(boss, owner_engine):
    c, h = boss
    cid = add(c, h).json()["client"]["id"]
    weekly_for(c, h, cid, title="Vitres")
    first = find(owner_engine, cid)[0]
    assert first["price"] is None and first["property_id"] is None and first["property_name"] is None
    assert first["description"] == "Entretien ménager - Vitres - 06/11/2025"


def test_a_property_without_price_has_none(boss, owner_engine):
    c, h = boss
    cid = add(c, h).json()["client"]["id"]
    pid = add_prop(c, h, cid).json()["property"]["id"]
    weekly_for(c, h, cid, pid)
    assert find(owner_engine, cid)[0]["price"] is None


def test_an_occurrence_on_a_live_invoice_line_is_not_offered_again(boss, owner_engine):
    c, h = boss
    cid = add(c, h).json()["client"]["id"]
    eid = weekly_for(c, h, cid, priced_property(c, h, cid))
    sql(owner_engine, "INSERT INTO invoices (number, bill_name, issued_on, subtotal, total) VALUES (7, 'X', '2025-12-01', 120, 120)")
    sql(owner_engine, "INSERT INTO invoice_lines (invoice_id, position, description, amount, event_id, occurrence_date) SELECT id, 1, 'x', 120, :e, '2025-11-13' FROM invoices", e=eid)
    assert "2025-11-13" not in [i["occurrence_date"] for i in find(owner_engine, cid)]
    sql(owner_engine, "UPDATE invoice_lines SET live = false")
    assert "2025-11-13" in [i["occurrence_date"] for i in find(owner_engine, cid)]


def test_default_description_is_cut_to_200_characters():
    assert len(default_description("x" * 300, "t", date(2025, 11, 6))) == 200
    assert default_description(None, "Vitres", date(2025, 1, 2)) == "Entretien ménager - Vitres - 02/01/2025"


def test_the_route_lists_a_range_and_checks_it(boss):
    c, h = boss
    cid = add(c, h).json()["client"]["id"]
    weekly_for(c, h, cid, priced_property(c, h, cid))
    r = c.get(f"/api/clients/{cid}/billable", params={"from": "2025-11-01", "to": "2025-11-30"})
    assert r.status_code == 200 and len(r.json()["occurrences"]) == 4
    for bad in ({"from": "2025-11-30", "to": "2025-11-01"}, {"from": "2024-01-01", "to": "2025-11-30"}):
        r = c.get(f"/api/clients/{cid}/billable", params=bad)
        assert (r.status_code, r.json()) == (422, {"error": "bad_range"})
    assert c.get("/api/clients/99999/billable", params={"from": "2025-11-01", "to": "2025-11-30"}).status_code == 404


def test_billable_marks_visits_without_checkout(boss, owner_engine):
    c, h = boss
    cid = add(c, h).json()["client"]["id"]
    eid = weekly_for(c, h, cid, priced_property(c, h, cid))
    for day, closed in (("2025-11-06", "now()"), ("2025-11-13", "NULL")):  # closed, and started but never closed
        sql(owner_engine, f"INSERT INTO visits (event_id, occurrence_date, visit_date, client_id, property_name, closed_at) VALUES (:e, :d, :d, :c, 'x', {closed})", e=eid, d=day, c=cid)
    items = find(owner_engine, cid)
    assert [(i["date"], i["checked_out"]) for i in items] == [("2025-11-06", True), ("2025-11-13", False), ("2025-11-20", False), ("2025-11-27", False)]
