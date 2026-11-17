import pytest
from sqlalchemy import text

import app.cli as cli

ARGS = ["create-superadmin", "--username", "Boss", "--email", "Boss@Example.com"]


def rows(engine, q):
    with engine.begin() as c:
        return c.execute(text(q)).fetchall()


def test_creates_superadmin(owner_engine, monkeypatch, capsys):
    monkeypatch.setattr(cli, "read_password", lambda: "Str0ng!pass")
    assert cli.main(ARGS) == 0
    (u,) = rows(owner_engine, "SELECT username, email, role, locale, password_hash, status FROM users")
    assert u[:4] == ("boss", "boss@example.com", "superadmin", "fr-CA")
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
    assert cli.main(["create-superadmin", "--username", "two", "--email", "two@example.com"]) == 1
    assert rows(owner_engine, "SELECT count(*) FROM users")[0][0] == 1


def test_locale_option(owner_engine, monkeypatch):
    monkeypatch.setattr(cli, "read_password", lambda: "Str0ng!pass")
    assert cli.main(ARGS + ["--locale", "pt-BR"]) == 0
    assert rows(owner_engine, "SELECT locale FROM users")[0][0] == "pt-BR"
