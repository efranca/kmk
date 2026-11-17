import json
import re
from datetime import timedelta

import pytest

from app.emails.templates import render
from helpers import ORIGIN, PW, login, sql

NEW = "Newpass1!"
OTHER = "Another1!"


def post(client, path, body, headers=ORIGIN):
    return client.post(path, json=body, headers=headers)


def set_password(client, token, password=NEW):
    return post(client, "/api/auth/set-password", {"token": token, "password": password})


def forgot(client, identifier):
    return post(client, "/api/auth/forgot-password", {"identifier": identifier})


def test_forgot_password_identical_for_every_state(client, add_user, outbox):
    add_user("act", "act@example.com", locale="en")
    add_user("dis", "dis@example.com", status="disabled")
    add_user("del", "del@example.com", status="deleted")
    add_user("inv", "inv@example.com", password=None, status="invited")
    for ident in ("act", "ghost", "dis", "del", "inv"):
        r = forgot(client, ident)
        assert (r.status_code, r.json()) == (202, {"status": "ok"}), ident
    assert len(outbox) == 1
    m = outbox[0]
    assert m.to == "act@example.com" and "/set-password#token=" in m.text
    assert m.subject == render("reset", "en", "x", "y").subject


def test_forgot_password_rate_limited_generically(client, add_user, outbox):
    add_user()
    for _ in range(3):
        assert forgot(client, "ghost").status_code == 202
    r = forgot(client, "ghost")
    assert r.status_code == 429 and r.json() == {"error": "too_many_attempts"}
    assert login(client, "ghost", "x").status_code == 401  # login limits are separate


def test_invite_accept_then_login(client, add_user, make_token, owner_engine):
    add_user("newbie", "newbie@example.com", password=None, status="invited")
    token = make_token("newbie", "invite", timedelta(hours=48))
    r = set_password(client, token)
    assert (r.status_code, r.json()) == (200, {"status": "ok"})
    assert sql(owner_engine, "SELECT count(*) FROM sessions")[0][0] == 0
    assert sql(owner_engine, "SELECT status FROM users")[0][0] == "active"
    assert login(client, "newbie", NEW).status_code == 200
    again = set_password(client, token)
    assert (again.status_code, again.json()) == (400, {"error": "invalid_token"})


def test_reset_flow_revokes_all_sessions(client, make_client, add_user, make_token):
    add_user()
    other = make_client()
    assert login(client).status_code == 200 and login(other).status_code == 200
    assert set_password(client, make_token("alice", "reset")).status_code == 200
    assert client.get("/api/auth/me").status_code == 401
    assert other.get("/api/auth/me").status_code == 401
    assert login(make_client(), "alice", NEW).status_code == 200
    assert login(make_client(), "alice", PW).status_code == 401


def test_weak_password_does_not_consume_token(client, add_user, make_token):
    add_user()
    token = make_token("alice", "reset")
    r = set_password(client, token, "short")
    assert r.status_code == 422
    assert r.json()["error"] == "weak_password" and "too_short" in r.json()["rules"]
    assert set_password(client, token).status_code == 200


def test_bad_tokens_are_generic(make_client, add_user, make_token, owner_engine):
    c = make_client(rl_identifier_max=20, rl_ip_max=20)
    add_user()
    add_user("bob", "bob@example.com")
    expired = make_token("alice", "reset", timedelta(seconds=-1))
    used = make_token("bob", "invite")
    superseded = make_token("alice", "reset")
    newest = make_token("alice", "reset")
    assert set_password(c, used).status_code == 400  # invite token for an active user is not valid either
    disabled = make_token("bob", "reset")
    sql(owner_engine, "UPDATE users SET status = 'deleted' WHERE username = 'bob'")  # (disabled accounts may be reset: review F2)
    for bad in ("unknown", expired, superseded, disabled):
        r = set_password(c, bad)
        assert (r.status_code, r.json()) == (400, {"error": "invalid_token"})
    assert set_password(c, newest).status_code == 200
    assert set_password(c, newest).status_code == 400


def test_set_password_token_rate_limit(client):
    for _ in range(3):
        assert set_password(client, "nope").status_code == 400
    r = set_password(client, "nope")
    assert r.status_code == 429 and r.json() == {"error": "too_many_attempts"}


def test_change_password(client, make_client, add_user):
    add_user()
    token = login(client).json()["csrf_token"]
    other = make_client()
    assert login(other).status_code == 200
    h = {**ORIGIN, "X-CSRF-Token": token}

    def change(current, new, headers=h, c=client):
        return post(c, "/api/auth/change-password", {"current_password": current, "new_password": new}, headers)

    assert change("Wrong1!pw", OTHER).json() == {"error": "invalid_current_password"}
    assert change("Wrong1!pw", OTHER).status_code == 403
    assert change(PW, PW).json() == {"error": "same_password"}
    weak = change(PW, "short")
    assert weak.status_code == 422 and weak.json()["error"] == "weak_password"
    assert change(PW, OTHER, headers=ORIGIN).status_code == 403  # no CSRF token
    assert change(PW, OTHER, c=make_client()).status_code == 401  # anonymous
    assert change(PW, OTHER).status_code == 200
    assert other.get("/api/auth/me").status_code == 401  # other sessions revoked
    assert client.get("/api/auth/me").status_code == 200  # current kept
    assert login(make_client(), "alice", OTHER).status_code == 200


def test_audit_and_logs_never_hold_secrets(client, make_client, add_user, outbox, owner_engine, caplog):
    import logging

    caplog.set_level(logging.DEBUG)
    add_user()
    forgot(client, "alice")
    token = re.search(r"#token=([^&\s]+)", outbox[0].text).group(1)
    assert set_password(client, token).status_code == 200
    csrf = login(client, "alice", NEW).json()["csrf_token"]
    post(client, "/api/auth/change-password", {"current_password": NEW, "new_password": OTHER}, {**ORIGIN, "X-CSRF-Token": csrf})
    rows = sql(owner_engine, "SELECT action, details::text FROM audit_log ORDER BY id")
    actions = {r[0] for r in rows}
    assert {"password_reset_requested", "password_reset_completed", "login_success", "password_changed"} <= actions
    blob = json.dumps([list(r) for r in rows]) + caplog.text
    for secret in (token, NEW, OTHER, PW):
        assert secret not in blob


def test_no_store_header(client, add_user):
    add_user()
    assert forgot(client, "alice").headers["cache-control"] == "no-store"
    assert client.get("/api/auth/me").headers["cache-control"] == "no-store"


@pytest.mark.parametrize("role", ["admin", "superadmin"])
def test_admins_can_reset_their_own_password_with_forgot_password(make_client, add_user, outbox, role):
    add_user("boss", "boss@example.com", role=role)
    c = make_client()
    assert forgot(c, "boss").status_code == 202
    assert len(outbox) == 1 and outbox[0].to == "boss@example.com"
    token = re.search(r"#token=([^&\s]+)", outbox[0].text).group(1)
    assert set_password(c, token).status_code == 200
    assert login(make_client(), "boss", PW).status_code == 401  # the old password no longer works
    body = login(make_client(), "boss", NEW).json()
    assert (body["user"]["role"], body["mfa"]) == (role, "ok")


def test_an_admin_with_two_step_still_needs_the_code_after_a_reset(make_client, add_mfa_user, outbox, owner_engine):
    add_mfa_user("boss", role="admin")
    c = make_client()
    forgot(c, "boss")
    token = re.search(r"#token=([^&\s]+)", outbox[0].text).group(1)
    assert set_password(c, token).status_code == 200
    body = login(make_client(), "boss", NEW).json()
    assert body["mfa"] == "verify"  # a password reset must never bypass two-step verification


# ---- language ----

def locale_call(c, token, value):
    return post(c, "/api/auth/locale", {"locale": value}, {**ORIGIN, "X-CSRF-Token": token})


def test_locale_change(make_client, add_user, owner_engine):
    add_user("alice", "alice@example.com", locale="fr-CA")
    add_user("bob", "bob@example.com", locale="fr-CA")
    c = make_client()
    token = login(c).json()["csrf_token"]
    r = locale_call(c, token, "en")
    assert r.status_code == 200 and r.json()["user"]["locale"] == "en"
    assert c.get("/api/auth/me").json()["user"]["locale"] == "en"
    langs = dict(sql(owner_engine, "SELECT username, locale FROM users"))
    assert langs == {"alice": "en", "bob": "fr-CA"}  # only the caller changed
    row = sql(owner_engine, "SELECT actor_user_id, target_user_id, details::text FROM audit_log WHERE action = 'locale_changed'")
    assert len(row) == 1 and row[0][0] == row[0][1] and '"from": "fr-CA"' in row[0][2] and '"to": "en"' in row[0][2]
    assert locale_call(c, token, "en").status_code == 200  # same value again
    assert sql(owner_engine, "SELECT count(*) FROM audit_log WHERE action = 'locale_changed'")[0][0] == 1  # no second row


def test_locale_validation(client, add_user):
    add_user()
    token = login(client).json()["csrf_token"]
    assert locale_call(client, token, "de").status_code == 422
    assert post(client, "/api/auth/locale", {}, {**ORIGIN, "X-CSRF-Token": token}).status_code == 422


def test_locale_needs_login_and_csrf(client, add_user, make_client):
    add_user()
    assert post(make_client(), "/api/auth/locale", {"locale": "en"}).status_code == 401
    login(client)
    assert post(client, "/api/auth/locale", {"locale": "en"}).status_code == 403  # no CSRF token


def test_next_email_uses_the_new_language(client, add_user, outbox):
    from app.emails.templates import render

    add_user()
    token = login(client).json()["csrf_token"]
    locale_call(client, token, "en")
    assert forgot(client, "alice").status_code == 202
    m = outbox[0]
    assert m.subject == render("reset", "en", "x", "y").subject
    assert re.search(r"#token=\S+&lang=en", m.text)
