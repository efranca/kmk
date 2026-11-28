import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from test_schema_permissions import add_user

INVOICE = (
    "INSERT INTO invoices (number, bill_name, issued_on, subtotal, total, status, paid_on) "
    "VALUES (:n, 'X', '2026-11-27', 0, 0, :s, :p) RETURNING id"
)


def add_event(conn):
    uid = conn.execute(text("SELECT id FROM users LIMIT 1")).scalar()
    return conn.execute(
        text("INSERT INTO events (title, start_date, start_time, created_by, updated_by) VALUES ('Clean', '2026-11-05', '09:00', :u, :u) RETURNING id"),
        dict(u=uid),
    ).scalar()


def add_invoice(conn, number, status="unpaid", paid_on=None):
    return conn.execute(text(INVOICE), dict(n=number, s=status, p=paid_on)).scalar()


def add_line(conn, invoice_id, event_id, day="2026-11-05", live=True):
    conn.execute(
        text(
            "INSERT INTO invoice_lines (invoice_id, position, description, amount, event_id, occurrence_date, live) "
            "VALUES (:i, 1, 'Entretien', 120, :e, :d, :l)"
        ),
        dict(i=invoice_id, e=event_id, d=day, l=live),
    )


def test_app_role_can_write_invoices(owner_engine, app_engine):
    with app_engine.begin() as c:
        iid = add_invoice(c, 7)
        c.execute(
            text("INSERT INTO invoice_lines (invoice_id, position, description, amount) VALUES (:i, 1, 'Vitres', 40)"),
            dict(i=iid),
        )
        assert c.execute(text("SELECT count(*) FROM invoice_lines WHERE invoice_id = :i"), dict(i=iid)).scalar() == 1
        c.execute(text("UPDATE invoices SET status = 'cancelled' WHERE id = :i"), dict(i=iid))
        assert c.execute(text("SELECT status FROM invoices WHERE id = :i"), dict(i=iid)).scalar() == "cancelled"
        c.execute(text("DELETE FROM invoices WHERE id = :i"), dict(i=iid))


@pytest.mark.parametrize("status,paid_on", [("paid", None), ("unpaid", "2026-11-27")])
def test_paid_needs_a_date(owner_engine, status, paid_on):
    with pytest.raises(IntegrityError):
        with owner_engine.begin() as c:
            add_invoice(c, 7, status, paid_on)


def test_an_occurrence_is_on_one_live_line(owner_engine):
    with owner_engine.begin() as c:
        add_user(c)
        eid = add_event(c)
        first = add_invoice(c, 7)
        second = add_invoice(c, 8)
        add_line(c, first, eid)
    with pytest.raises(IntegrityError):
        with owner_engine.begin() as c:
            add_line(c, second, eid)
    with owner_engine.begin() as c:
        c.execute(text("UPDATE invoice_lines SET live = false WHERE invoice_id = :i"), dict(i=first))
        add_line(c, second, eid)


@pytest.mark.parametrize("price,ok", [("-1", False), ("100000", False), ("120.50", True)])
def test_visit_price_range(owner_engine, price, ok):
    with owner_engine.begin() as c:
        cid = c.execute(text("INSERT INTO clients (name) VALUES ('Ducarme') RETURNING id")).scalar()

    def insert():
        with owner_engine.begin() as c:
            c.execute(
                text("INSERT INTO properties (client_id, name, visit_price) VALUES (:c, 'Beach house', :p)"),
                dict(c=cid, p=price),
            )

    if ok:
        insert()
    else:
        with pytest.raises(IntegrityError):
            insert()
