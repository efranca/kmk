import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, ProgrammingError

HASH = "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$aGFzaA"


def add_user(conn, username="alice", email="alice@example.com", role="user", locale="fr-CA", status="active"):
    conn.execute(
        text(
            "INSERT INTO users (username, email, password_hash, role, locale, status) "
            "VALUES (:u, :e, :h, :r, :l, :s)"
        ),
        dict(u=username, e=email, h=HASH, r=role, l=locale, s=status),
    )


def test_app_role_can_insert_audit_but_not_update_delete_or_select(owner_engine, app_engine):
    with app_engine.begin() as c:
        c.execute(text("INSERT INTO audit_log (action) VALUES ('x')"))
    for sql in ("UPDATE audit_log SET action = 'y'", "DELETE FROM audit_log", "SELECT * FROM audit_log"):
        with pytest.raises(ProgrammingError):
            with app_engine.begin() as c:
                c.execute(text(sql))


def test_app_role_has_full_dml_on_other_tables(owner_engine, app_engine):
    with app_engine.begin() as c:
        add_user(c)
        c.execute(text("UPDATE users SET locale = 'en' WHERE username = 'alice'"))
        assert c.execute(text("SELECT locale FROM users WHERE username = 'alice'")).scalar() == "en"
        c.execute(text("DELETE FROM users WHERE username = 'alice'"))


def test_only_one_superadmin(owner_engine):
    with pytest.raises(IntegrityError):
        with owner_engine.begin() as c:
            add_user(c, "a", "a@example.com", role="superadmin")
            add_user(c, "b", "b@example.com", role="superadmin")


@pytest.mark.parametrize("field,value", [("role", "root"), ("locale", "de"), ("status", "gone")])
def test_check_constraints(owner_engine, field, value):
    with pytest.raises(IntegrityError):
        with owner_engine.begin() as c:
            add_user(c, **{field: value})


def test_unique_and_lowercase(owner_engine):
    with pytest.raises(IntegrityError):
        with owner_engine.begin() as c:
            add_user(c, "dup", "one@example.com")
            add_user(c, "dup", "two@example.com")
    with pytest.raises(IntegrityError):
        with owner_engine.begin() as c:
            add_user(c, "MixedCase", "m@example.com")
    with pytest.raises(IntegrityError):
        with owner_engine.begin() as c:
            add_user(c, "fine", "Mixed@Example.com")
