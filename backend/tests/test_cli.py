import pytest
from sqlalchemy import text

import app.cli as cli

ARGS = ["create-superadmin", "--username", "Boss", "--email", "Boss@Example.com", "--name", "  Boss   Person "]


def rows(engine, q):
    with engine.begin() as c:
        return c.execute(text(q)).fetchall()


def test_creates_superadmin(owner_engine, monkeypatch, capsys):
    monkeypatch.setattr(cli, "read_password", lambda: "Str0ng!pass")
    assert cli.main(ARGS) == 0
    (u,) = rows(owner_engine, "SELECT username, email, role, locale, password_hash, status FROM users")
    assert u[:4] == ("boss", "boss@example.com", "superadmin", "fr-CA")
    assert rows(owner_engine, "SELECT name FROM users")[0][0] == "Boss Person"  # cleaned
    assert u[4].startswith("$argon2id$") and u[5] == "active"
    (a,) = rows(owner_engine, "SELECT action, actor_user_id FROM audit_log")
    assert a == ("user_created", None)
    out = capsys.readouterr()
    assert "Str0ng!pass" not in out.out + out.err


def test_weak_password_refused(owner_engine, monkeypatch):
    monkeypatch.setattr(cli, "read_password", lambda: "weak")
    assert cli.main(ARGS) == 1
    assert rows(owner_engine, "SELECT count(*) FROM users")[0][0] == 0


def test_second_superadmin_refused(owner_engine, monkeypatch):
    monkeypatch.setattr(cli, "read_password", lambda: "Str0ng!pass")
    assert cli.main(ARGS) == 0
    assert cli.main(["create-superadmin", "--username", "two", "--email", "two@example.com", "--name", "Two Person"]) == 1
    assert rows(owner_engine, "SELECT count(*) FROM users")[0][0] == 1


def test_locale_option(owner_engine, monkeypatch):
    monkeypatch.setattr(cli, "read_password", lambda: "Str0ng!pass")
    assert cli.main(ARGS + ["--locale", "pt-BR"]) == 0
    assert rows(owner_engine, "SELECT locale FROM users")[0][0] == "pt-BR"


def test_reset_mfa_clears_everything(make_client, add_mfa_user, owner_engine, capsys):
    secret = add_mfa_user("alice")
    c1, c2 = make_client(), make_client()
    from helpers import login

    login(c1, "alice")
    login(c2, "alice")
    assert cli.main(["reset-mfa", "--username", "Alice"]) == 0
    row = rows(owner_engine, "SELECT mfa_enabled, mfa_secret, mfa_last_step FROM users")[0]
    assert tuple(row) == (False, None, None)
    assert rows(owner_engine, "SELECT count(*) FROM recovery_codes")[0][0] == 0
    assert rows(owner_engine, "SELECT count(*) FROM sessions WHERE revoked_at IS NULL")[0][0] == 0
    audit_rows = rows(owner_engine, "SELECT action, actor_user_id, details::text FROM audit_log WHERE action = 'mfa_reset'")
    assert [(r[0], r[1]) for r in audit_rows] == [("mfa_reset", None)] and "cli" in audit_rows[0][2]
    out = capsys.readouterr()
    assert secret not in out.out + out.err
    assert c1.get("/api/auth/me").status_code == 401  # sessions are gone
    body = login(make_client(), "alice").json()
    assert (body["mfa"], body["mfa_enabled"]) == ("ok", False)  # password alone works again


def test_reset_mfa_unknown_user(owner_engine, capsys):
    assert cli.main(["reset-mfa", "--username", "ghost"]) == 1
    assert rows(owner_engine, "SELECT count(*) FROM audit_log")[0][0] == 0  # nothing is written for an unknown user


# ---- a name for every person ----

def test_create_superadmin_requires_a_name(owner_engine, monkeypatch):
    monkeypatch.setattr(cli, "read_password", lambda: "Str0ng!pass")
    without = [a for a in ARGS if a not in ("--name", "  Boss   Person ")]
    with pytest.raises(SystemExit) as e:
        cli.main(without)
    assert e.value.code == 2  # a usage error
    assert rows(owner_engine, "SELECT count(*) FROM users")[0][0] == 0


@pytest.mark.parametrize("bad", ["", "   ", "<b>x</b>", "x" * 101, "a\nb"])
def test_create_superadmin_refuses_an_invalid_name(owner_engine, monkeypatch, capsys, bad):
    monkeypatch.setattr(cli, "read_password", lambda: "Str0ng!pass")
    args = ["create-superadmin", "--username", "Boss", "--email", "boss@example.com", "--name", bad]
    assert cli.main(args) == 1
    assert rows(owner_engine, "SELECT count(*) FROM users")[0][0] == 0  # nothing was created
    err = capsys.readouterr().err
    assert "name" in err.lower() and (not bad.strip() or bad.strip() not in err)  # the reason is given without echoing the input


def test_set_name_sets_and_changes_a_name(owner_engine, add_user, capsys):
    add_user("alice", "alice@example.com")
    assert cli.main(["set-name", "--username", "ALICE", "--name", " Alice   Roy "]) == 0
    assert rows(owner_engine, "SELECT name FROM users")[0][0] == "Alice Roy"
    assert cli.main(["set-name", "--username", "alice", "--name", "Alice R."]) == 0
    assert rows(owner_engine, "SELECT name FROM users")[0][0] == "Alice R."
    audit_rows = rows(owner_engine, "SELECT action, actor_user_id, details::text FROM audit_log ORDER BY id")
    assert [(r[0], r[1]) for r in audit_rows] == [("user_updated", None), ("user_updated", None)]
    for _, _, details in audit_rows:
        assert '"fields": ["name"]' in details and '"via": "cli"' in details
        assert "Alice" not in details  # field name only, never the value


def test_set_name_works_for_the_super_admin(owner_engine, add_user):
    add_user("root", "root@example.com", role="superadmin")
    assert cli.main(["set-name", "--username", "root", "--name", "Rita Root"]) == 0
    assert rows(owner_engine, "SELECT name FROM users")[0][0] == "Rita Root"


def test_set_name_unchanged_writes_no_audit_row(owner_engine, add_user):
    add_user("alice", "alice@example.com")
    cli.main(["set-name", "--username", "alice", "--name", "Alice Roy"])
    cli.main(["set-name", "--username", "alice", "--name", "Alice Roy"])
    assert rows(owner_engine, "SELECT count(*) FROM audit_log")[0][0] == 1


def test_set_name_unknown_user_and_invalid_name(owner_engine, add_user, capsys):
    add_user("alice", "alice@example.com")
    assert cli.main(["set-name", "--username", "ghost", "--name", "Nobody"]) == 1
    assert cli.main(["set-name", "--username", "alice", "--name", "<script>"]) == 1
    assert rows(owner_engine, "SELECT name FROM users")[0][0] is None
    assert rows(owner_engine, "SELECT count(*) FROM audit_log")[0][0] == 0
