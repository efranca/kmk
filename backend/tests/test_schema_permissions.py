import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, ProgrammingError

HASH = "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$aGFzaA"


def add_user(conn, username="alice", email="alice@example.com", role="user", locale="fr-CA", status="active", hash=HASH):
    conn.execute(
        text(
            "INSERT INTO users (username, email, password_hash, role, locale, status) "
            "VALUES (:u, :e, :h, :r, :l, :s)"
        ),
        dict(u=username, e=email, h=hash, r=role, l=locale, s=status),
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


def test_tokens_table_permissions_and_checks(owner_engine, app_engine):
    with app_engine.begin() as c:
        add_user(c)
        uid = c.execute(text("SELECT id FROM users")).scalar()
        c.execute(
            text("INSERT INTO tokens (token_hash, user_id, purpose, expires_at) VALUES ('h1', :u, 'invite', now() + interval '1 day')"),
            dict(u=uid),
        )
        c.execute(text("UPDATE tokens SET used_at = now() WHERE token_hash = 'h1'"))
        c.execute(text("DELETE FROM tokens WHERE token_hash = 'h1'"))
    with pytest.raises(IntegrityError):
        with owner_engine.begin() as c:
            uid = c.execute(text("SELECT id FROM users")).scalar()
            c.execute(
                text("INSERT INTO tokens (token_hash, user_id, purpose, expires_at) VALUES ('h2', :u, 'other', now())"),
                dict(u=uid),
            )


def test_invited_user_without_password(owner_engine):
    with owner_engine.begin() as c:
        add_user(c, status="invited", hash=None)
        assert c.execute(text("SELECT status, password_hash FROM users")).one() == ("invited", None)


def test_login_attempt_kind_check(owner_engine):
    with owner_engine.begin() as c:
        c.execute(text("INSERT INTO login_attempts (ip, identifier, success) VALUES ('1.1.1.1', 'a', false)"))
        assert c.execute(text("SELECT kind FROM login_attempts")).scalar() == "login"
    with pytest.raises(IntegrityError):
        with owner_engine.begin() as c:
            c.execute(text("INSERT INTO login_attempts (ip, identifier, success, kind) VALUES ('1.1.1.1', 'a', false, 'bogus')"))


def test_recovery_codes_permissions_and_unique_hash(owner_engine, app_engine):
    with app_engine.begin() as c:
        add_user(c)
        uid = c.execute(text("SELECT id FROM users")).scalar()
        c.execute(text("INSERT INTO recovery_codes (user_id, code_hash) VALUES (:u, 'h1')"), dict(u=uid))
        c.execute(text("UPDATE recovery_codes SET used_at = now() WHERE code_hash = 'h1'"))
        c.execute(text("DELETE FROM recovery_codes WHERE code_hash = 'h1'"))
    with pytest.raises(IntegrityError):
        with owner_engine.begin() as c:
            uid = c.execute(text("SELECT id FROM users")).scalar()
            c.execute(text("INSERT INTO recovery_codes (user_id, code_hash) VALUES (:u, 'dup')"), dict(u=uid))
            c.execute(text("INSERT INTO recovery_codes (user_id, code_hash) VALUES (:u, 'dup')"), dict(u=uid))


def test_mfa_kind_and_defaults(owner_engine):
    with owner_engine.begin() as c:
        c.execute(text("INSERT INTO login_attempts (ip, identifier, success, kind) VALUES ('1.1.1.1', 'a', false, 'mfa')"))
        add_user(c)
        uid = c.execute(text("SELECT id FROM users")).scalar()
        c.execute(
            text("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('t', :u, now() + interval '1 day')"),
            dict(u=uid),
        )
        assert c.execute(text("SELECT mfa_verified FROM sessions")).scalar() is True
        assert c.execute(text("SELECT mfa_last_step FROM users")).scalar() is None
