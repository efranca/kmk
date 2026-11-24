import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from test_schema_schedule import add_user


def add_task(conn, user_id, **overrides):
    values = dict(title="Mop", status="pending", completed_at=None, category_id=None, by=user_id)
    values.update(overrides)
    return conn.execute(
        text(
            "INSERT INTO tasks (title, status, completed_at, category_id, created_by, updated_by) "
            "VALUES (:title, :status, CAST(:completed_at AS timestamptz), :category_id, :by, :by) RETURNING id"
        ),
        values,
    ).scalar()


def add_category(conn, user_id, name="Office"):
    return conn.execute(
        text("INSERT INTO task_categories (name, created_by) VALUES (:n, :u) RETURNING id"), dict(n=name, u=user_id)
    ).scalar()


def test_task_insert_defaults(owner_engine):
    with owner_engine.begin() as c:
        tid = add_task(c, add_user(c))
        row = c.execute(text("SELECT status, show_on_dashboard FROM tasks WHERE id = :i"), dict(i=tid)).one()
    assert tuple(row) == ("pending", True)


@pytest.mark.parametrize("title", ["   ", "x" * 201])
def test_bad_title_rejected(owner_engine, title):
    with pytest.raises(IntegrityError):
        with owner_engine.begin() as c:
            add_task(c, add_user(c), title=title)


def test_completed_needs_completed_at(owner_engine):
    with pytest.raises(IntegrityError):
        with owner_engine.begin() as c:
            add_task(c, add_user(c), status="completed")
    with pytest.raises(IntegrityError):
        with owner_engine.begin() as c:
            add_task(c, add_user(c), completed_at="2026-11-24T12:00:00Z")
    with owner_engine.begin() as c:
        add_task(c, add_user(c), status="completed", completed_at="2026-11-24T12:00:00Z")


def test_category_name_unique_case_insensitive(owner_engine):
    with pytest.raises(IntegrityError):
        with owner_engine.begin() as c:
            u = add_user(c)
            add_category(c, u, "Office")
            add_category(c, u, "office")


def test_deleting_category_keeps_task(owner_engine):
    with owner_engine.begin() as c:
        u = add_user(c)
        cat = add_category(c, u)
        tid = add_task(c, u, category_id=cat)
        c.execute(text("DELETE FROM task_categories WHERE id = :i"), dict(i=cat))
        assert c.execute(text("SELECT category_id FROM tasks WHERE id = :i"), dict(i=tid)).scalar() is None


def test_deleting_task_deletes_people(owner_engine):
    with owner_engine.begin() as c:
        u = add_user(c)
        tid = add_task(c, u)
        c.execute(text("INSERT INTO task_people (task_id, user_id) VALUES (:t, :u)"), dict(t=tid, u=u))
        c.execute(text("DELETE FROM tasks WHERE id = :i"), dict(i=tid))
        assert c.execute(text("SELECT count(*) FROM task_people")).scalar() == 0


def test_app_role_has_dml_on_task_tables(owner_engine, app_engine):
    with app_engine.connect() as c:
        for table in ("task_categories", "tasks", "task_people"):
            for priv in ("SELECT", "INSERT", "UPDATE", "DELETE"):
                assert c.execute(text("SELECT has_table_privilege('kmk_app', :t, :p)"), dict(t=table, p=priv)).scalar()
