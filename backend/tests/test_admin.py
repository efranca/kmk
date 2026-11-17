import re

import pytest

from helpers import ORIGIN, PW, login, sql

NEW = "Newpass1!"


def admin_client(make_client, add_user, role="admin", username="boss"):
    add_user(username, f"{username}@example.com", role=role)
    c = make_client()
    token = login(c, username).json()["csrf_token"]
    return c, {**ORIGIN, "X-CSRF-Token": token}


def create(c, h, **kw):
    body = {"username": "Maria", "email": "MARIA@Example.com", "locale": "pt-BR", **kw}
    return c.post("/api/admin/users", json=body, headers=h)


def user_id(owner_engine, username):
    return sql(owner_engine, "SELECT id FROM users WHERE username = :u", u=username)[0][0]


@pytest.mark.parametrize(
    "method_path_body",
    [
        ("/api/admin/users", {"username": "x1x", "email": "x@example.com", "locale": "en"}),
        ("/api/admin/users/1/invite", None),
        ("/api/admin/users/1/reset", None),
    ],
)
def test_admin_gate(make_client, add_user, method_path_body):
    path, body = method_path_body
    anon = make_client()
    assert anon.post(path, json=body, headers=ORIGIN).status_code == 401
    add_user("plain", "plain@example.com", role="user")
    user_c = make_client()
    tok = login(user_c, "plain").json()["csrf_token"]
    assert user_c.post(path, json=body, headers={**ORIGIN, "X-CSRF-Token": tok}).status_code == 403
    add_user("boss", "boss@example.com", role="admin")
    admin_c = make_client()
    tok = login(admin_c, "boss").json()["csrf_token"]
    assert admin_c.post(path, json=body, headers=ORIGIN).status_code == 403  # no CSRF token
    assert admin_c.post(path, json=body, headers={"X-CSRF-Token": tok}).status_code == 403  # no Origin


def test_create_user_invites(make_client, add_user, outbox, owner_engine):
    c, h = admin_client(make_client, add_user)
    r = create(c, h)
    assert r.status_code == 201
    body = r.json()
    assert body["email_queued"] is True
    assert body["user"]["username"] == "maria" and body["user"]["role"] == "user" and body["user"]["locale"] == "pt-BR"
    row = sql(owner_engine, "SELECT email, role, status, password_hash FROM users WHERE username = 'maria'")[0]
    assert tuple(row) == ("maria@example.com", "user", "invited", None)
    assert len(outbox) == 1
    m = outbox[0]
    assert m.to == "maria@example.com" and "horas" in m.text
    token = re.search(r"/set-password#token=([^&\s]+)", m.text).group(1)
    actor = sql(owner_engine, "SELECT actor_user_id FROM audit_log WHERE action = 'user_invited'")[0][0]
    assert actor == user_id(owner_engine, "boss")
    # the emailed link completes the invite and the new user can sign in
    anon = make_client()
    assert anon.post("/api/auth/set-password", json={"token": token, "password": NEW}, headers=ORIGIN).status_code == 200
    assert login(make_client(), "maria", NEW).status_code == 200


def test_create_user_validation(make_client, add_user, outbox):
    c, h = admin_client(make_client, add_user)
    assert create(c, h).status_code == 201
    sent = len(outbox)
    assert create(c, h, email="other@example.com").status_code == 409  # same username
    assert create(c, h, username="other", email="maria@EXAMPLE.com").status_code == 409  # same email, other case
    for bad in (
        {"username": "a"},
        {"username": "has space"},
        {"email": "not-an-email"},
        {"locale": "de"},
    ):
        assert create(c, h, **bad).status_code == 422, bad
    assert len(outbox) == sent


def test_resend_invite(make_client, add_user, outbox, owner_engine):
    c, h = admin_client(make_client, add_user)
    create(c, h)
    first = re.search(r"#token=([^&\s]+)", outbox[0].text).group(1)
    uid = user_id(owner_engine, "maria")
    r = c.post(f"/api/admin/users/{uid}/invite", headers=h)
    assert (r.status_code, r.json()) == (202, {"status": "ok"})
    second = re.search(r"#token=([^&\s]+)", outbox[1].text).group(1)
    anon = make_client()
    assert anon.post("/api/auth/set-password", json={"token": first, "password": NEW}, headers=ORIGIN).status_code == 400
    assert anon.post("/api/auth/set-password", json={"token": second, "password": NEW}, headers=ORIGIN).status_code == 200
    assert c.post(f"/api/admin/users/{uid}/invite", headers=h).json() == {"error": "not_invited"}
    assert c.post("/api/admin/users/99999/invite", headers=h).status_code == 404
    assert "invite_resent" in {r[0] for r in sql(owner_engine, "SELECT action FROM audit_log")}


def test_admin_reset(make_client, add_user, outbox, owner_engine):
    c, h = admin_client(make_client, add_user)
    add_user("carl", "carl@example.com")
    add_user("dis", "dis@example.com", status="disabled")
    add_user("inv", "inv@example.com", password=None, status="invited")
    r = c.post(f"/api/admin/users/{user_id(owner_engine, 'carl')}/reset", headers=h)
    assert (r.status_code, r.json()) == (202, {"status": "ok"})
    assert len(outbox) == 1 and outbox[0].to == "carl@example.com"
    details = sql(owner_engine, "SELECT details::text FROM audit_log WHERE action = 'password_reset_requested'")[0][0]
    assert '"admin"' in details
    for name in ("dis", "inv"):
        assert c.post(f"/api/admin/users/{user_id(owner_engine, name)}/reset", headers=h).json() == {"error": "not_active"}
    assert c.post("/api/admin/users/99999/reset", headers=h).status_code == 404


def test_only_superadmin_can_reset_the_superadmin(make_client, add_user, outbox, owner_engine):
    add_user("root", "root@example.com", role="superadmin")
    root_id = user_id(owner_engine, "root")
    admin_c, admin_h = admin_client(make_client, add_user)
    assert admin_c.post(f"/api/admin/users/{root_id}/reset", headers=admin_h).status_code == 403
    assert outbox == []
    # the superadmin can use the admin endpoints, including on themselves
    su = make_client()
    tok = login(su, "root").json()["csrf_token"]
    assert su.post(f"/api/admin/users/{root_id}/reset", headers={**ORIGIN, "X-CSRF-Token": tok}).status_code == 202
    assert len(outbox) == 1


def test_invite_link_carries_the_invitees_language(make_client, add_user, outbox):
    c, h = admin_client(make_client, add_user)
    create(c, h)  # locale pt-BR
    assert re.search(r"#token=\S+&lang=pt-BR", outbox[0].text)
