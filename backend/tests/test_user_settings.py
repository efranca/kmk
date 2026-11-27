import pytest

from helpers import ORIGIN, login, sql
from test_admin import admin_client, user_id
from test_quote_arrival import send


def setting(owner_engine, username):
    return sql(owner_engine, "SELECT settings FROM users WHERE username = :u", u=username)[0][0]


def patch(c, h, uid, body):
    return c.patch(f"/api/admin/users/{uid}/settings", json=body, headers=h)


def test_super_admin_turns_the_quote_flag_on_for_an_admin(make_client, add_user, owner_engine):
    add_user("ana", "ana@example.com", role="admin")
    c, h = admin_client(make_client, add_user, role="superadmin")
    r = patch(c, h, user_id(owner_engine, "ana"), {"notify_quotes": True})
    assert r.status_code == 200 and r.json()["settings"] == {"notify_quotes": True}
    assert setting(owner_engine, "ana") == {"notify_quotes": True}
    listed = {u["username"]: u for u in c.get("/api/admin/users").json()["users"]}
    assert listed["ana"]["settings"] == {"notify_quotes": True} and listed["boss"]["settings"] == {"notify_quotes": False}
    audit = sql(owner_engine, "SELECT details::text FROM audit_log WHERE action = 'user_updated'")
    assert audit and "settings" in audit[0][0]


def test_settings_are_refused_when_unknown_wrong_or_for_staff(make_client, add_user, owner_engine):
    add_user("ana", "ana@example.com", role="admin")
    add_user("tom", "tom@example.com", role="user")
    c, h = admin_client(make_client, add_user, role="superadmin")
    ana, tom = user_id(owner_engine, "ana"), user_id(owner_engine, "tom")
    assert patch(c, h, ana, {"colour": "red"}).status_code == 422
    assert patch(c, h, ana, {"notify_quotes": "yes"}).status_code == 422
    assert patch(c, h, ana, {}).status_code == 422
    assert patch(c, h, tom, {"notify_quotes": True}).status_code == 422  # Staff never get quote emails
    assert setting(owner_engine, "tom") == {}


def test_authority_follows_the_edit_rule(make_client, add_user, owner_engine):
    add_user("ana", "ana@example.com", role="admin")
    add_user("bea", "bea@example.com", role="admin")
    c, h = admin_client(make_client, add_user, role="admin", username="chief")
    assert patch(c, h, user_id(owner_engine, "ana"), {"notify_quotes": True}).status_code == 403
    add_user("tom", "tom@example.com", role="user")
    staff = make_client()
    tok = login(staff, "tom").json()["csrf_token"]
    assert patch(staff, {**ORIGIN, "X-CSRF-Token": tok}, user_id(owner_engine, "ana"), {"notify_quotes": True}).status_code == 403


def opt_in(owner_engine, *names):
    for n in names:
        sql(owner_engine, "UPDATE users SET settings = '{\"notify_quotes\": true}' WHERE username = :u", u=n)


def test_each_opted_in_admin_gets_an_email_in_their_language_with_a_link(client, owner_engine, add_user, outbox):
    add_user("boss", "boss@example.com", role="superadmin", locale="fr-CA")
    add_user("ana", "ana@example.com", role="admin", locale="pt-BR")
    add_user("bea", "bea@example.com", role="admin")  # not ticked
    add_user("gone", "gone@example.com", role="admin", status="disabled")
    add_user("tom", "tom@example.com", role="user")
    opt_in(owner_engine, "boss", "ana", "gone", "tom")
    qid = send(client)
    by = {m.to: m for m in outbox}
    assert set(by) == {"boss@example.com", "ana@example.com"}
    assert f"/quotes/{qid}" in by["ana@example.com"].text and f"/quotes/{qid}" in by["ana@example.com"].html
    assert by["boss@example.com"].subject == f"Nouvelle demande de soumission D-{qid:04d}"
    assert by["ana@example.com"].subject == f"Novo pedido de orçamento D-{qid:04d}"
    for m in outbox:
        assert "maria@example.com" not in m.text.lower() and "418-555-0100" not in m.text


def test_the_company_address_still_gets_its_email_too(client, owner_engine, add_user, outbox):
    add_user("ana", "ana@example.com", role="admin")
    opt_in(owner_engine, "ana")
    sql(owner_engine, "INSERT INTO app_settings (key, value) VALUES ('quote_notify_email', 'team@gmail.com')")
    send(client)
    assert sorted(m.to for m in outbox) == ["ana@example.com", "team@gmail.com"]
