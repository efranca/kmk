import json

import pytest

import app.push.service as push
from helpers import ORIGIN, login, make_settings, sql

SUB = {"endpoint": "https://push.example/abc", "keys": {"p256dh": "P" * 20, "auth": "A" * 10}}


class Gone(Exception):
    pass


def session(make_client, add_user, username, role, **settings):
    add_user(username, f"{username}@example.com", role=role)
    c = make_client(vapid_public_key="PUBKEY", vapid_private_key="PRIVKEY", **settings)
    token = login(c, username).json()["csrf_token"]
    return c, {**ORIGIN, "X-CSRF-Token": token}


@pytest.fixture
def sent(monkeypatch):
    calls = []
    monkeypatch.setattr(push, "webpush", lambda **kw: calls.append(kw))
    return calls


def test_admin_subscribes_and_the_test_push_is_sent_once(make_client, add_user, sent):
    c, h = session(make_client, add_user, "ana", "admin")
    assert c.get("/api/push/key").json() == {"key": "PUBKEY"}
    assert c.post("/api/push/subscriptions", json=SUB, headers=h).status_code == 201
    assert c.post("/api/push/subscriptions", json=SUB, headers=h).status_code == 201  # same device again: still one
    assert c.post("/api/push/test", headers=h).json() == {"sent": 1}
    assert len(sent) == 1 and sent[0]["subscription_info"]["endpoint"] == SUB["endpoint"]
    assert sent[0]["vapid_private_key"] == "PRIVKEY"
    assert json.loads(sent[0]["data"])["body"] == "Notifications are working"


def test_a_user_gets_403_everywhere(make_client, add_user):
    c, h = session(make_client, add_user, "tom", "user")
    assert c.get("/api/push/key").status_code == 403
    assert c.post("/api/push/subscriptions", json=SUB, headers=h).status_code == 403
    assert c.request("DELETE", "/api/push/subscriptions", json={"endpoint": SUB["endpoint"]}, headers=h).status_code == 403
    assert c.post("/api/push/test", headers=h).status_code == 403


def test_a_gone_subscription_is_deleted(make_client, add_user, owner_engine, monkeypatch):
    c, h = session(make_client, add_user, "ana", "admin")
    c.post("/api/push/subscriptions", json=SUB, headers=h)

    class Response:
        status_code = 410

    def gone(**kw):
        raise push.WebPushException("gone", response=Response())

    monkeypatch.setattr(push, "webpush", gone)
    assert c.post("/api/push/test", headers=h).json() == {"sent": 0}
    assert sql(owner_engine, "SELECT count(*) FROM push_subscriptions")[0][0] == 0


def test_send_to_admins_skips_users_and_disabled_admins(add_user, owner_engine, app_engine, sent):
    add_user("ana", "ana@example.com", role="admin")
    add_user("boss", "boss@example.com", role="superadmin")
    add_user("tom", "tom@example.com", role="user")
    add_user("gone", "gone@example.com", role="admin", status="disabled")
    for row in sql(owner_engine, "SELECT id, username FROM users"):
        sql(owner_engine, "INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (:u, :e, 'p', 'a')", u=row[0], e=f"https://push.example/{row[1]}")
    push.send_to_admins(app_engine, make_settings(vapid_public_key="K", vapid_private_key="S"), {"title": "T", "body": "B", "url": "/quotes/1"})
    assert sorted(c["subscription_info"]["endpoint"] for c in sent) == ["https://push.example/ana", "https://push.example/boss"]
    assert all(r[0] is not None for r in sql(owner_engine, "SELECT last_used_at FROM push_subscriptions WHERE endpoint LIKE '%ana' OR endpoint LIKE '%boss'"))


def test_no_vapid_keys_sends_nothing(add_user, owner_engine, app_engine, sent):
    add_user("ana", "ana@example.com", role="admin")
    sql(owner_engine, "INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (1, 'https://push.example/x', 'p', 'a')")
    push.send_to_admins(app_engine, make_settings(), {"title": "T", "body": "B", "url": "/"})
    assert sent == []


def test_a_failing_push_service_never_raises(add_user, owner_engine, app_engine, monkeypatch):
    add_user("ana", "ana@example.com", role="admin")
    sql(owner_engine, "INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (1, 'https://push.example/x', 'p', 'a')")
    monkeypatch.setattr(push, "webpush", lambda **kw: (_ for _ in ()).throw(RuntimeError("boom")))
    push.send_to_admins(app_engine, make_settings(vapid_public_key="K", vapid_private_key="S"), {"title": "T", "body": "B", "url": "/"})


def test_delete_only_removes_the_callers_own_subscription(make_client, add_user, owner_engine):
    c, h = session(make_client, add_user, "ana", "admin")
    other, oh = session(make_client, add_user, "ben", "admin")
    c.post("/api/push/subscriptions", json=SUB, headers=h)
    assert other.request("DELETE", "/api/push/subscriptions", json={"endpoint": SUB["endpoint"]}, headers=oh).status_code == 204
    assert sql(owner_engine, "SELECT count(*) FROM push_subscriptions")[0][0] == 1
    assert c.request("DELETE", "/api/push/subscriptions", json={"endpoint": SUB["endpoint"]}, headers=h).status_code == 204
    assert sql(owner_engine, "SELECT count(*) FROM push_subscriptions")[0][0] == 0


@pytest.mark.parametrize("bad", [{"endpoint": "http://insecure.example/x"}, {"endpoint": "https://e/" + "x" * 1000}, {"keys": {"p256dh": "", "auth": "a"}}])
def test_bad_subscriptions_are_refused(make_client, add_user, bad):
    c, h = session(make_client, add_user, "ana", "admin")
    assert c.post("/api/push/subscriptions", json={**SUB, **bad}, headers=h).status_code == 422


def test_disabling_a_person_removes_their_subscriptions(make_client, add_user, owner_engine):
    root, rh = session(make_client, add_user, "boss", "superadmin")
    ana, ah = session(make_client, add_user, "ana", "admin")
    ana.post("/api/push/subscriptions", json=SUB, headers=ah)
    ana_id = sql(owner_engine, "SELECT id FROM users WHERE username = 'ana'")[0][0]
    assert root.post(f"/api/admin/users/{ana_id}/disable", headers=rh).status_code == 200
    assert sql(owner_engine, "SELECT count(*) FROM push_subscriptions")[0][0] == 0


def test_demoting_a_person_removes_their_subscriptions(make_client, add_user, owner_engine):
    root, rh = session(make_client, add_user, "boss", "superadmin")
    ana, ah = session(make_client, add_user, "ana", "admin")
    ana.post("/api/push/subscriptions", json=SUB, headers=ah)
    ana_id = sql(owner_engine, "SELECT id FROM users WHERE username = 'ana'")[0][0]
    assert root.post(f"/api/admin/users/{ana_id}/role", json={"role": "user"}, headers=rh).status_code == 200
    assert sql(owner_engine, "SELECT count(*) FROM push_subscriptions")[0][0] == 0
