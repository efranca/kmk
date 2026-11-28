import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from test_schema_permissions import add_user


def setup_visit(conn, day="2026-11-05"):
    add_user(conn)
    uid = conn.execute(text("SELECT id FROM users LIMIT 1")).scalar()
    eid = conn.execute(
        text("INSERT INTO events (title, start_date, start_time, created_by, updated_by) VALUES ('Clean', :d, '09:00', :u, :u) RETURNING id"),
        dict(d=day, u=uid),
    ).scalar()
    cid = conn.execute(text("INSERT INTO clients (name) VALUES ('Ducarme') RETURNING id")).scalar()
    pid = conn.execute(text("INSERT INTO properties (client_id, name) VALUES (:c, 'Beach house') RETURNING id"), dict(c=cid)).scalar()
    return uid, eid, pid


def add_visit(conn, eid, pid, day="2026-11-05"):
    return conn.execute(
        text(
            "INSERT INTO visits (event_id, occurrence_date, visit_date, property_id, property_name) "
            "VALUES (:e, :d, :d, :p, 'Beach house') RETURNING id"
        ),
        dict(e=eid, d=day, p=pid),
    ).scalar()


def add_person(conn, vid, uid, withdrawn=None):
    conn.execute(
        text("INSERT INTO visit_people (visit_id, user_id, user_name, withdrawn_at) VALUES (:v, :u, 'Alice', :w)"),
        dict(v=vid, u=uid, w=withdrawn),
    )


def test_visit_unique_per_occurrence(owner_engine):
    with owner_engine.begin() as c:
        _, eid, pid = setup_visit(c)
        add_visit(c, eid, pid)
    with pytest.raises(IntegrityError):
        with owner_engine.begin() as c:
            add_visit(c, eid, pid)


def test_one_active_checkin_per_person(owner_engine):
    with owner_engine.begin() as c:
        uid, eid, pid = setup_visit(c)
        vid = add_visit(c, eid, pid)
        add_person(c, vid, uid)
    with pytest.raises(IntegrityError):
        with owner_engine.begin() as c:
            add_person(c, vid, uid)
    with owner_engine.begin() as c:
        c.execute(text("UPDATE visit_people SET withdrawn_at = now() WHERE visit_id = :v"), dict(v=vid))
        add_person(c, vid, uid)


def test_visit_survives_event_and_property_deletion(owner_engine):
    with owner_engine.begin() as c:
        _, eid, pid = setup_visit(c)
        vid = add_visit(c, eid, pid)
    with owner_engine.begin() as c:
        c.execute(text("DELETE FROM events WHERE id = :e"), dict(e=eid))
        c.execute(text("DELETE FROM properties WHERE id = :p"), dict(p=pid))
    with owner_engine.begin() as c:
        row = c.execute(text("SELECT event_id, property_id, property_name FROM visits WHERE id = :v"), dict(v=vid)).one()
    assert tuple(row) == (None, None, "Beach house")


@pytest.mark.parametrize("size,ctype", [(614401, "image/webp"), (0, "image/webp"), (1000, "image/png")])
def test_photo_size_and_type_are_checked(owner_engine, size, ctype):
    with owner_engine.begin() as c:
        _, eid, pid = setup_visit(c)
        vid = add_visit(c, eid, pid)
    with pytest.raises(IntegrityError):
        with owner_engine.begin() as c:
            c.execute(
                text(
                    "INSERT INTO visit_photos (visit_id, file_id, room_name, content_type, size, sha256) "
                    "VALUES (:v, 'f1', 'Kitchen', :t, :s, 'abc')"
                ),
                dict(v=vid, t=ctype, s=size),
            )
