import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, ProgrammingError

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


RECORD = ("visits", "visit_people", "visit_photos", "visit_room_skips")


def _record_rows(owner_engine):
    with owner_engine.begin() as c:
        uid, eid, pid = setup_visit(c)
        vid = add_visit(c, eid, pid)
        add_person(c, vid, uid)
        rid = c.execute(text("INSERT INTO property_rooms (property_id, name, position) VALUES (:p, 'Kitchen', 0) RETURNING id"), dict(p=pid)).scalar()
        c.execute(
            text("INSERT INTO visit_photos (visit_id, file_id, room_id, room_name, content_type, size, sha256) VALUES (:v, 'f1', :r, 'Kitchen', 'image/webp', 1, 'x')"),
            dict(v=vid, r=rid),
        )
        c.execute(text("INSERT INTO visit_room_skips (visit_id, room_id, room_name, reason) VALUES (:v, :r, 'Kitchen', 'locked')"), dict(v=vid, r=rid))
        c.execute(text("INSERT INTO visit_corrections (visit_id, kind, reason) VALUES (:v, 'close', 'forgot')"), dict(v=vid))
    return vid, pid


def test_the_app_role_cannot_delete_the_visit_record(owner_engine, app_engine):
    """Migration 0025: no app path deletes visits, people, photos or skips; a DELETE FROM visits by the app role would
    otherwise cascade-erase the append-only corrections."""
    vid, pid = _record_rows(owner_engine)
    for table in RECORD:
        with pytest.raises(ProgrammingError, match="permission denied"):
            with app_engine.begin() as c:
                c.execute(text(f"DELETE FROM {table}"))
    with app_engine.begin() as c:  # it still reads and changes them, and manages the rooms
        c.execute(text("UPDATE visits SET closed_at = now() WHERE id = :v"), dict(v=vid))
        c.execute(text("UPDATE visit_photos SET deleted_at = now()"))
        c.execute(text("DELETE FROM property_rooms"))  # the photo and the skip keep their room name (room_id SET NULL)
        c.execute(text("DELETE FROM properties WHERE id = :p"), dict(p=pid))  # the visit keeps its copies
    with owner_engine.begin() as c:
        counts = [c.execute(text(f"SELECT count(*) FROM {t}")).scalar() for t in (*RECORD, "visit_corrections")]
        assert counts == [1, 1, 1, 1, 1]
        assert tuple(c.execute(text("SELECT room_id, room_name FROM visit_photos")).one()) == (None, "Kitchen")


def test_visit_people_has_a_plain_visit_index(owner_engine):
    with owner_engine.begin() as c:
        definition = c.execute(text("SELECT indexdef FROM pg_indexes WHERE indexname = 'visit_people_visit_id_idx'")).scalar()
    assert definition is not None and definition.endswith("USING btree (visit_id)")


def test_migration_0025_downgrades_and_upgrades(owner_engine):
    from alembic import command
    from alembic.config import Config

    from conftest import BACKEND

    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "alembic"))

    def state():
        with owner_engine.begin() as c:
            grants = [c.execute(text(f"SELECT has_table_privilege('kmk_app', '{t}', 'DELETE')")).scalar() for t in (*RECORD, "property_rooms")]
            index = c.execute(text("SELECT count(*) FROM pg_indexes WHERE indexname = 'visit_people_visit_id_idx'")).scalar()
        return grants, index

    assert state() == ([False, False, False, False, True], 1)
    try:
        command.downgrade(cfg, "0024")
        assert state() == ([True, True, True, True, True], 0)
    finally:
        command.upgrade(cfg, "head")
    assert state() == ([False, False, False, False, True], 1)


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
