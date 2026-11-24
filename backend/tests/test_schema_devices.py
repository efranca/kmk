from sqlalchemy import text

from test_schema_schedule import add_user


def columns(conn):
    rows = conn.execute(text("SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'sessions'"))
    return {name: (kind, nullable) for name, kind, nullable in rows}


def test_sessions_have_a_public_id_and_last_access_columns(owner_engine):
    with owner_engine.begin() as c:
        cols = columns(c)
    assert cols["id"][0] == "uuid" and cols["id"][1] == "NO"
    assert cols["last_seen_at"] == ("timestamp with time zone", "NO")
    assert cols["last_ip"][1] == "YES" and cols["country"][1] == "YES" and cols["city"][1] == "YES"


def test_a_new_session_gets_an_id_and_last_seen_defaults(owner_engine):
    with owner_engine.begin() as c:
        uid = add_user(c)
        c.execute(text("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('h1', :u, now() + interval '1 day')"), dict(u=uid))
        c.execute(text("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('h2', :u, now() + interval '1 day')"), dict(u=uid))
        ids = c.execute(text("SELECT id FROM sessions ORDER BY token_hash")).scalars().all()
        assert len(set(ids)) == 2
        assert c.execute(text("SELECT count(*) FROM sessions WHERE last_seen_at IS NULL")).scalar() == 0


def test_country_is_two_capital_letters_or_null(owner_engine):
    import pytest
    from sqlalchemy.exc import DBAPIError

    for bad in ("CAN", "ca", "C1"):
        with pytest.raises(DBAPIError):
            with owner_engine.begin() as c:
                uid = add_user(c)
                c.execute(text("INSERT INTO sessions (token_hash, user_id, expires_at, country) VALUES ('h', :u, now(), :c)"), dict(u=uid, c=bad))


def test_the_app_role_can_update_the_new_columns(owner_engine, app_engine):
    with owner_engine.begin() as c:
        uid = add_user(c)
        c.execute(text("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('h', :u, now() + interval '1 day')"), dict(u=uid))
    with app_engine.begin() as c:
        c.execute(text("UPDATE sessions SET last_seen_at = now(), last_ip = '1.2.3.4', country = 'CA', city = 'Montréal' WHERE token_hash = 'h'"))
        assert c.execute(text("SELECT country FROM sessions WHERE token_hash = 'h'")).scalar() == "CA"
