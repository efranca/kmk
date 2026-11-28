from concurrent.futures import ThreadPoolExecutor

import pytest

from helpers import sql
from test_clients_api import add
from test_properties_api import add_prop
from test_schedule_api import WEEKLY_THU, create as create_event, session


@pytest.fixture
def boss(make_client, add_user):
    return session(make_client, add_user, "boss", role="admin")


@pytest.fixture
def staff(make_client, add_user):
    return session(make_client, add_user, "zoe")


def past_event(c, h, cid, **kw):
    """A weekly cleaning series starting Thursday 2025-11-06, for a client, on a property priced 120."""
    pid = kw.pop("property_id", None)
    if pid is None:
        pid = add_prop(c, h, cid, visit_price="120.00").json()["property"]["id"]
    return create_event(c, h, client_id=cid, property_id=pid, recurrence=WEEKLY_THU, start_date="2025-11-06", title="Cleaning", **kw).json()["event"]["id"]


def agenda(eid, day, amount="120.00", description="Entretien ménager - Beach house"):
    return {"event_id": eid, "occurrence_date": day, "description": description, "amount": amount}


def bill(c, h, cid, lines, **kw):
    body = {"client_id": cid, "issued_on": "2026-11-27", "lines": lines, **kw}
    return c.post("/api/invoices", json=body, headers=h)


def invoice_of(r):
    assert r.status_code == 201, r.text
    return r.json()["invoice"]


def test_staff_cannot_bill(boss, staff):
    c, h = boss
    cid = add(c, h).json()["client"]["id"]
    s, _ = staff
    r = s.get(f"/api/clients/{cid}/billable", params={"from": "2025-11-01", "to": "2025-11-30"})
    assert (r.status_code, r.json()) == (403, {"error": "forbidden"})


def test_first_invoice_is_007_then_008(boss):
    c, h = boss
    cid = add(c, h).json()["client"]["id"]
    eid = past_event(c, h, cid)
    first = invoice_of(bill(c, h, cid, [agenda(eid, "2025-11-06")]))
    second = invoice_of(bill(c, h, cid, [agenda(eid, "2025-11-13")]))
    assert (first["number"], first["reference"]) == (7, "007")
    assert (second["number"], second["reference"]) == (8, "008")


def test_totals_and_snapshot(boss):
    c, h = boss
    cid = add(c, h, name="Ducarme", contact_name="Mike").json()["client"]["id"]
    eid = past_event(c, h, cid)
    inv = invoice_of(bill(c, h, cid, [agenda(eid, "2025-11-06", "120.00"), {"description": "Vitres", "amount": "75.50"}], extra="10"))
    assert (inv["subtotal"], inv["tax"], inv["extra"], inv["total"]) == ("195.50", "0.00", "10.00", "205.50")
    assert inv["bill_name"] == "Ducarme / Mike" and inv["bill_city"] == "Québec" and inv["bill_phone"] == "418-555-0101"
    assert inv["status"] == "unpaid" and inv["paid_on"] is None and inv["client_id"] == cid and inv["issued_on"] == "2026-11-27"
    assert [(x["description"], x["amount"], x["event_id"], x["occurrence_date"]) for x in inv["lines"]] == [
        ("Entretien ménager - Beach house", "120.00", eid, "2025-11-06"),
        ("Vitres", "75.50", None, None),
    ]


def test_pdf_saved_as_admin_document_of_the_client(boss, staff, owner_engine):
    c, h = boss
    cid = add(c, h).json()["client"]["id"]
    eid = past_event(c, h, cid)
    inv = invoice_of(bill(c, h, cid, [agenda(eid, "2025-11-06")]))
    docs = c.get("/api/documents").json()
    doc = next(d for d in docs["documents"] if d["id"] == inv["document_id"])
    assert (doc["title"], doc["client_id"], doc["visibility"], doc["content_type"], doc["file_name"]) == ("Facture 007", cid, "admins", "application/pdf", "Facture-007.pdf")
    category = next(k for k in docs["categories"] if k["id"] == doc["category_id"])
    assert (category["name"], category["icon"]) == ("Factures", "🧾")
    second = invoice_of(bill(c, h, cid, [agenda(eid, "2025-11-13")]))
    again = next(d for d in c.get("/api/documents").json()["documents"] if d["id"] == second["document_id"])
    assert again["category_id"] == category["id"]
    assert sql(owner_engine, "SELECT count(*) FROM document_categories WHERE lower(name) = 'factures'")[0][0] == 1
    s, _ = staff
    assert all(d["client_id"] != cid or d["visibility"] != "admins" for d in s.get("/api/documents").json()["documents"])
    assert not [d for d in s.get("/api/documents").json()["documents"] if d["title"].startswith("Facture")]
    assert sql(owner_engine, "SELECT substring(data from 1 for 4) FROM document_files WHERE document_id = :d", d=inv["document_id"])[0][0] == b"%PDF"


def test_an_occurrence_is_billed_once(boss):
    c, h = boss
    cid = add(c, h).json()["client"]["id"]
    eid = past_event(c, h, cid)
    invoice_of(bill(c, h, cid, [agenda(eid, "2025-11-06")]))
    r = bill(c, h, cid, [agenda(eid, "2025-11-06")])
    assert (r.status_code, r.json()) == (409, {"error": "already_billed"})
    r = bill(c, h, cid, [agenda(eid, "2025-11-13"), agenda(eid, "2025-11-13")])
    assert (r.status_code, r.json()) == (422, {"error": "duplicate_line"})
    assert bill(c, h, cid, [agenda(eid, "2025-11-13")]).status_code == 201  # the refused ones used no number


def test_parallel_billing(boss, make_client, add_user):
    c, h = boss
    c2, h2 = session(make_client, add_user, "boss2", role="admin")
    cid = add(c, h).json()["client"]["id"]
    eid = past_event(c, h, cid)
    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(lambda ch: bill(ch[0], ch[1], cid, [agenda(eid, "2025-11-06")]), [(c, h), (c2, h2)]))
    assert sorted(r.status_code for r in results) == [201, 409]
    assert next(r for r in results if r.status_code == 409).json() == {"error": "already_billed"}
    assert invoice_of(bill(c, h, cid, [agenda(eid, "2025-11-13")]))["number"] == 8


def test_refuses_foreign_future_or_cancelled_occurrences(boss):
    c, h = boss
    a = add(c, h).json()["client"]["id"]
    b = add(c, h, name="Marc Dion").json()["client"]["id"]
    eid = past_event(c, h, a)
    foreign = past_event(c, h, b)
    future = create_event(c, h, client_id=a, start_date="2099-01-01", title="Later").json()["event"]["id"]
    assert c.delete(f"/api/schedule/events/{eid}", params={"scope": "this", "occurrence_date": "2025-11-13"}, headers=h).status_code in (200, 204)
    for line in (agenda(foreign, "2025-11-06"), agenda(future, "2099-01-01"), agenda(eid, "2025-11-13"), agenda(eid, "2025-11-07"), agenda(99999, "2025-11-06")):
        r = bill(c, h, a, [line])
        assert (r.status_code, r.json()) == (422, {"error": "occurrence_not_billable"}), line
    assert bill(c, h, 99999, [{"description": "x", "amount": "1"}]).json() == {"error": "client_not_found"}


def test_manual_lines_and_validation(boss):
    c, h = boss
    cid = add(c, h).json()["client"]["id"]
    assert bill(c, h, cid, [{"description": "Après-construction", "amount": "850"}]).status_code == 201
    ok = {"description": "x", "amount": "1"}
    for bad in (
        dict(lines=[]),
        dict(lines=[{"description": "x" * 201, "amount": "1"}]),
        dict(lines=[{"description": "  ", "amount": "1"}]),
        dict(lines=[{"description": "x", "amount": "-1"}]),
        dict(lines=[{"description": "x", "amount": "1.234"}]),
        dict(lines=[{"description": "x", "amount": 1.5}]),
        dict(lines=[{"description": "x", "amount": "1", "event_id": 1}]),
        dict(lines=[ok], extra="-1"),
        dict(lines=[ok] * 101),
        dict(lines=[ok], colour="red"),
    ):
        r = bill(c, h, cid, bad.pop("lines"), **bad)
        assert r.status_code == 422, (r.text, bad)


def test_list_filter_search_and_unpaid_total(boss):
    c, h = boss
    a = add(c, h, name="Ducarme").json()["client"]["id"]
    b = add(c, h, name="Marc Dion", city="Lévis").json()["client"]["id"]
    for cid, amount in ((a, "100"), (b, "50.50"), (a, "20")):
        invoice_of(bill(c, h, cid, [{"description": "x", "amount": amount}]))
    everything = c.get("/api/invoices").json()
    assert [i["number"] for i in everything["invoices"]] == [9, 8, 7]
    assert "lines" not in everything["invoices"][0] and everything["unpaid_total"] == "170.50"
    unpaid = c.get("/api/invoices", params={"status": "unpaid"}).json()
    assert len(unpaid["invoices"]) == 3 and unpaid["unpaid_total"] == "170.50"
    assert [i["number"] for i in c.get("/api/invoices", params={"q": "007"}).json()["invoices"]] == [7]
    assert [i["number"] for i in c.get("/api/invoices", params={"q": "ducarme"}).json()["invoices"]] == [9, 7]
    assert [i["number"] for i in c.get("/api/invoices", params={"q": "lévis"}).json()["invoices"]] == [8]
    assert c.get("/api/invoices", params={"status": "paid"}).json() == {"invoices": [], "unpaid_total": "170.50"}
    assert c.get("/api/invoices", params={"status": "weird"}).status_code == 422
    one = c.get(f"/api/invoices/{everything['invoices'][2]['id']}").json()["invoice"]
    assert one["reference"] == "007" and len(one["lines"]) == 1
    assert c.get("/api/invoices/99999").status_code == 404


def test_staff_forbidden(boss, staff):
    c, h = boss
    cid = add(c, h).json()["client"]["id"]
    inv = invoice_of(bill(c, h, cid, [{"description": "x", "amount": "1"}]))
    s, sh = staff
    for r in (
        s.post("/api/invoices", json={"client_id": cid, "issued_on": "2026-11-27", "lines": [{"description": "x", "amount": "1"}]}, headers=sh),
        s.get("/api/invoices"),
        s.get(f"/api/invoices/{inv['id']}"),
    ):
        assert (r.status_code, r.json()) == (403, {"error": "forbidden"})


def test_audit_row_written(boss, owner_engine):
    c, h = boss
    cid = add(c, h).json()["client"]["id"]
    invoice_of(bill(c, h, cid, [{"description": "x", "amount": "1"}]))
    rows = sql(owner_engine, "SELECT details FROM audit_log WHERE action = 'invoice_created'")
    assert len(rows) == 1 and rows[0][0]["number"] == 7 and rows[0][0]["client_id"] == cid
