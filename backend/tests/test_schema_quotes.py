import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from test_schema_schedule import add_user

QUOTE = dict(kind="airbnb", name="Maria", email="m@example.com", phone="418-555-0100", locale="fr-CA", ip="1.2.3.4", ip_key="1.2.3.4", token_hash="x" * 64)


def add_quote(conn, **overrides):
    v = {**QUOTE, **overrides}
    cols = ", ".join(v)
    marks = ", ".join(f":{k}" for k in v)
    return conn.execute(text(f"INSERT INTO quotes ({cols}) VALUES ({marks}) RETURNING id"), v).scalar()


def test_app_role_has_dml_on_quote_tables(owner_engine, app_engine):
    with owner_engine.begin() as c:
        uid = add_user(c)
        qid = add_quote(c)
    with app_engine.begin() as c:
        c.execute(text("INSERT INTO quote_photos (quote_id, content_type, size, data) VALUES (:q, 'image/png', 3, 'abc')"), dict(q=qid))
        c.execute(text("INSERT INTO quote_messages (quote_id, direction, body, sent_at, delivery) VALUES (:q, 'out', 'hi', now(), 'sent')"), dict(q=qid))
        c.execute(text("INSERT INTO app_settings (key, value) VALUES ('public_phone', '123')"))
        c.execute(text("INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (:u, 'https://e/1', 'k', 'a')"), dict(u=uid))
        c.execute(text("UPDATE quotes SET status = 'new' WHERE id = :q"), dict(q=qid))
        assert c.execute(text("SELECT count(*) FROM quote_photos")).scalar() == 1
        c.execute(text("DELETE FROM push_subscriptions"))
        c.execute(text("DELETE FROM quotes WHERE id = :q"), dict(q=qid))


@pytest.mark.parametrize(
    "overrides",
    [dict(status="bogus"), dict(kind="villa"), dict(locale="en")],
)
def test_quote_checks(owner_engine, overrides):
    with pytest.raises(IntegrityError):
        with owner_engine.begin() as c:
            add_quote(c, **overrides)


def test_photo_type_and_message_direction_checks(owner_engine):
    with owner_engine.begin() as c:
        qid = add_quote(c)
    with pytest.raises(IntegrityError):
        with owner_engine.begin() as c:
            c.execute(text("INSERT INTO quote_photos (quote_id, content_type, size, data) VALUES (:q, 'image/gif', 3, 'abc')"), dict(q=qid))
    with pytest.raises(IntegrityError):
        with owner_engine.begin() as c:
            c.execute(text("INSERT INTO quote_messages (quote_id, direction, body, sent_at, delivery) VALUES (:q, 'in', 'hi', now(), 'sent')"), dict(q=qid))
    with pytest.raises(IntegrityError):
        with owner_engine.begin() as c:
            c.execute(text("INSERT INTO quote_messages (quote_id, direction, body, sent_at) VALUES (:q, 'out', 'hi', now())"), dict(q=qid))


def test_deleting_a_quote_cascades_to_photos_and_messages(owner_engine):
    with owner_engine.begin() as c:
        qid = add_quote(c)
        c.execute(text("INSERT INTO quote_photos (quote_id, content_type, size, data) VALUES (:q, 'image/png', 3, 'abc')"), dict(q=qid))
        c.execute(text("INSERT INTO quote_messages (quote_id, direction, body, sent_at) VALUES (:q, 'in', 'hi', now())"), dict(q=qid))
        c.execute(text("DELETE FROM quotes WHERE id = :q"), dict(q=qid))
        assert c.execute(text("SELECT count(*) FROM quote_photos")).scalar() == 0
        assert c.execute(text("SELECT count(*) FROM quote_messages")).scalar() == 0


def test_tasks_and_events_accept_null_creators(owner_engine):
    with owner_engine.begin() as c:
        c.execute(text("INSERT INTO tasks (title) VALUES ('From the website')"))
        c.execute(text("INSERT INTO events (title, start_date, start_time) VALUES ('Deadline', '2026-11-26', '10:00')"))


def test_quotes_category_is_seeded_once(owner_engine):
    import importlib.util
    from pathlib import Path

    path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0013_quotes.py"
    spec = importlib.util.spec_from_file_location("m0013", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    with owner_engine.begin() as c:
        c.execute(text("INSERT INTO task_categories (name) VALUES ('QUOTES')"))
        c.execute(text(mod.SEED_SQL))
        assert c.execute(text("SELECT count(*) FROM task_categories WHERE lower(name) = 'quotes'")).scalar() == 1
        c.execute(text("DELETE FROM task_categories"))
        c.execute(text(mod.SEED_SQL))
        c.execute(text(mod.SEED_SQL))
        rows = c.execute(text("SELECT name, icon FROM task_categories")).fetchall()
    assert [tuple(r) for r in rows] == [("Quotes", "📋")]
