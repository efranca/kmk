import importlib.util
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError

from test_schema_schedule import add_user

MIGRATION = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0011_documents.py"


def add_document(conn, user_id, **overrides):
    values = dict(title="Insurance policy", visibility="admins", by=user_id)
    values.update(overrides)
    return conn.execute(
        text("INSERT INTO documents (title, visibility, created_by, updated_by) VALUES (:title, :visibility, :by, :by) RETURNING id"),
        values,
    ).scalar()


def test_visibility_is_one_of_three_levels(owner_engine):
    with pytest.raises(IntegrityError):
        with owner_engine.begin() as c:
            add_document(c, add_user(c), visibility="public")


def test_a_document_has_all_file_fields_or_none(owner_engine):
    with owner_engine.begin() as c:
        uid = add_user(c)
        add_document(c, uid)  # pending: no file yet
    with pytest.raises(IntegrityError):
        with owner_engine.begin() as c:
            c.execute(text("UPDATE documents SET file_name = 'a.pdf'"))


def test_size_is_between_one_byte_and_fifty_megabytes(owner_engine):
    for bad in (0, 50 * 1024 * 1024 + 1):
        with pytest.raises(IntegrityError):
            with owner_engine.begin() as c:
                uid = add_user(c)
                did = add_document(c, uid)
                c.execute(text("UPDATE documents SET file_name='a.pdf', content_type='application/pdf', size_bytes=:s WHERE id=:i"), dict(s=bad, i=did))


def test_the_bytes_live_in_their_own_table_and_go_with_the_document(owner_engine):
    with owner_engine.begin() as c:
        uid = add_user(c)
        did = add_document(c, uid)
        c.execute(text("INSERT INTO document_files (document_id, data) VALUES (:i, :d)"), dict(i=did, d=b"%PDF-1.4 x"))
        assert c.execute(text("SELECT count(*) FROM document_files")).scalar() == 1
        c.execute(text("DELETE FROM documents WHERE id = :i"), dict(i=did))
        assert c.execute(text("SELECT count(*) FROM document_files")).scalar() == 0


def test_empty_bytes_are_refused(owner_engine):
    with pytest.raises(DBAPIError):
        with owner_engine.begin() as c:
            did = add_document(c, add_user(c))
            c.execute(text("INSERT INTO document_files (document_id, data) VALUES (:i, :d)"), dict(i=did, d=b""))


def test_deleting_a_category_leaves_the_document(owner_engine):
    with owner_engine.begin() as c:
        uid = add_user(c)
        cid = c.execute(text("INSERT INTO document_categories (name, icon) VALUES ('X', '📌') RETURNING id")).scalar()
        did = add_document(c, uid, )
        c.execute(text("UPDATE documents SET category_id = :c WHERE id = :d"), dict(c=cid, d=did))
        c.execute(text("DELETE FROM document_categories WHERE id = :c"), dict(c=cid))
        assert c.execute(text("SELECT category_id FROM documents WHERE id = :d"), dict(d=did)).scalar() is None


def test_category_names_are_unique_ignoring_case(owner_engine):
    with pytest.raises(IntegrityError):
        with owner_engine.begin() as c:
            c.execute(text("INSERT INTO document_categories (name) VALUES ('Contracts'), ('contracts')"))


def test_the_app_role_has_full_access(owner_engine, app_engine):
    with owner_engine.begin() as c:
        uid = add_user(c)
    with app_engine.begin() as c:
        did = add_document(c, uid)
        c.execute(text("INSERT INTO document_files (document_id, data) VALUES (:i, :d)"), dict(i=did, d=b"x"))
        c.execute(text("UPDATE documents SET title = 'y' WHERE id = :i"), dict(i=did))
        c.execute(text("DELETE FROM documents WHERE id = :i"), dict(i=did))


def test_starter_categories_are_added_once(owner_engine):
    spec = importlib.util.spec_from_file_location("m0011", MIGRATION)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    with owner_engine.begin() as c:
        c.execute(text("TRUNCATE document_categories RESTART IDENTITY CASCADE"))
        c.execute(text(mod.SEED_SQL))
        c.execute(text(mod.SEED_SQL))
        names = c.execute(text("SELECT name FROM document_categories ORDER BY name")).scalars().all()
    assert names == ["Clients", "Contracts", "Finance", "HR", "Insurance", "Other", "Safety"]
