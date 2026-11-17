import json
import time

import pytest

from helpers import ORIGIN, PW, login, make_settings, sql


def test_login_by_username_and_email_case_insensitive(client, add_user):
    add_user()
    r = login(client, "Alice")
    assert r.status_code == 200
    body = r.json()
    assert body["user"] == {"id": body["user"]["id"], "username": "alice", "email": "alice@example.com", "role": "user", "locale": "fr-CA"}
    assert "password_hash" not in r.text and body["csrf_token"]
    assert "kmk_session" in r.cookies
    assert login(client, "ALICE@Example.com").status_code == 200


def test_cookie_attributes_when_secure(make_client, add_user):
    add_user()
    c = make_client(cookie_secure=True)
    h = login(c, headers={"Origin": "http://testserver"}).headers["set-cookie"]
    for part in ("HttpOnly", "Secure", "SameSite=strict", "Path=/api", "Max-Age=432000"):
        assert part.lower() in h.lower()


@pytest.mark.parametrize("status", ["disabled", "deleted"])
def test_failures_are_indistinguishable(client, add_user, status):
    add_user("alice", "alice@example.com")
    add_user("dis", "dis@example.com", status=status)
    results = [
        login(client, "alice", "Wrong1!pw"),
        login(client, "nobody", "Wrong1!pw"),
        login(client, "dis", PW),
    ]
    for r in results:
        assert r.status_code == 401
        assert r.json() == {"error": "invalid_credentials"}


def test_unknown_user_still_runs_a_verify(client, monkeypatch):
    import app.auth.service as service

    calls = []
    real = service.verify_password
    monkeypatch.setattr(service, "verify_password", lambda h, p: calls.append(1) or real(h, p))
    assert login(client, "ghost").status_code == 401
    assert len(calls) == 1


def test_rate_limit_by_identifier(client, add_user):
    add_user()
    for _ in range(3):
        assert login(client, "alice", "Wrong1!pw").status_code == 401
    r = login(client, "alice", PW)
    assert r.status_code == 429 and r.json() == {"error": "too_many_attempts"}
    assert login(client, "someone-else", "x").status_code == 401


def test_rate_limit_by_ip(client):
    for i in range(6):
        assert login(client, f"user{i}", "x").status_code == 401
    assert login(client, "user99", "x").status_code == 429


def test_me_requires_session(client, add_user):
    add_user()
    r = client.get("/api/auth/me")
    assert r.status_code == 401 and r.json() == {"error": "unauthenticated"}
    login(client)
    r = client.get("/api/auth/me")
    assert r.status_code == 200 and r.json()["user"]["username"] == "alice" and r.json()["csrf_token"]


@pytest.mark.parametrize(
    "breaker",
    [
        "UPDATE sessions SET expires_at = now() - interval '1 minute'",
        "UPDATE sessions SET revoked_at = now()",
        "UPDATE users SET status = 'disabled'",
    ],
)
def test_session_expired_revoked_or_user_disabled_rejected(client, add_user, owner_engine, breaker):
    add_user()
    login(client)
    assert client.get("/api/auth/me").status_code == 200
    sql(owner_engine, breaker)
    assert client.get("/api/auth/me").status_code == 401


def test_logout_revokes_session(client, add_user, owner_engine):
    add_user()
    r = login(client)
    token, cookie = r.json()["csrf_token"], client.cookies["kmk_session"]
    out = client.post("/api/auth/logout", headers={**ORIGIN, "X-CSRF-Token": token})
    assert out.status_code == 204
    assert client.get("/api/auth/me", headers={"Cookie": f"kmk_session={cookie}"}).status_code == 401
    assert sql(owner_engine, "SELECT count(*) FROM sessions WHERE revoked_at IS NOT NULL")[0][0] == 1


def test_mutating_requests_need_origin_and_csrf(client, add_user):
    add_user()
    assert login(client, headers={}).status_code == 403
    assert login(client, headers={"Origin": "https://evil.example"}).status_code == 403
    token = login(client).json()["csrf_token"]
    assert client.post("/api/auth/logout", headers=ORIGIN).status_code == 403
    assert client.post("/api/auth/logout", headers={**ORIGIN, "X-CSRF-Token": "bad"}).status_code == 403
    assert client.post("/api/auth/logout", headers={**ORIGIN, "X-CSRF-Token": token}).status_code == 204


def test_logout_without_session_is_401(client):
    assert client.post("/api/auth/logout", headers=ORIGIN).status_code == 401


def test_oversized_input(client, owner_engine):
    t = time.monotonic()
    r = login(client, "alice", "a" * 1_000_000)
    assert r.status_code == 422 and time.monotonic() - t < 1
    assert sql(owner_engine, "SELECT count(*) FROM login_attempts")[0][0] == 0


def test_audit_rows(make_client, add_user, owner_engine):
    add_user()
    c = make_client(rl_identifier_max=1)
    bad = "Wr0ng!pass"
    assert login(c, "bob", bad).status_code == 401
    assert login(c, "bob", bad).status_code == 429
    token = login(c, "alice").json()["csrf_token"]
    c.post("/api/auth/logout", headers={**ORIGIN, "X-CSRF-Token": token})
    rows = sql(owner_engine, "SELECT action, ip, details::text FROM audit_log ORDER BY id")
    assert [r[0] for r in rows] == ["login_failed", "login_rate_limited", "login_success", "logout"]
    assert all(r[1] == "127.0.0.1" for r in rows)
    assert bad not in json.dumps([list(r) for r in rows]) and PW not in json.dumps([list(r) for r in rows])


def test_client_ip_header_trusted_only_from_loopback(make_client, owner_engine):
    spoof = {**ORIGIN, "X-Real-Client-Ip": "1.2.3.4"}
    make_client(peer="198.51.100.7").post("/api/auth/login", json={"identifier": "x", "password": "y"}, headers=spoof)
    make_client(peer="127.0.0.1").post("/api/auth/login", json={"identifier": "x", "password": "y"}, headers=spoof)
    ips = [r[0] for r in sql(owner_engine, "SELECT ip FROM audit_log ORDER BY id")]
    assert ips == ["198.51.100.7", "1.2.3.4"]


def test_invited_user_cannot_log_in(client, add_user, monkeypatch):
    import app.auth.service as service

    add_user("newbie", "newbie@example.com", password=None, status="invited")
    calls = []
    real = service.verify_password
    monkeypatch.setattr(service, "verify_password", lambda h, p: calls.append(1) or real(h, p))
    r = login(client, "newbie", PW)
    assert r.status_code == 401 and r.json() == {"error": "invalid_credentials"}
    assert len(calls) == 1


# ---- review F11: what people type into the username box ----

def test_audit_never_stores_what_was_typed_for_an_unknown_account(make_client, add_user, owner_engine):
    add_user()
    typed = "Hunter2!pasted-by-mistake"
    c = make_client(rl_identifier_max=1)
    login(c, typed, "x")  # fails and hits the limit, which also writes the lockout row
    login(c, typed, "x")
    rows = sql(owner_engine, "SELECT action, details::text FROM audit_log ORDER BY id")
    assert [r[0] for r in rows] == ["login_failed", "login_rate_limited"]
    assert all(typed.lower() not in (r[1] or "").lower() for r in rows)
    login(make_client(), "ALICE", "Wrong1!pw")  # a real account: the (normalized) name is useful and recorded
    details = sql(owner_engine, "SELECT details::text FROM audit_log WHERE action = 'login_failed' ORDER BY id DESC LIMIT 1")[0][0]
    assert '"alice"' in details


# ---- review F4: a flood of limited requests must not flood the append-only audit log ----

def test_a_flood_of_limited_requests_writes_one_lockout_row(make_client, owner_engine):
    c = make_client(rl_identifier_max=2)
    codes = [login(c, "ghost", "x").status_code for _ in range(60)]
    assert codes.count(401) == 2 and codes.count(429) == 58
    counts = dict(sql(owner_engine, "SELECT action, count(*) FROM audit_log GROUP BY action"))
    assert counts == {"login_failed": 2, "login_rate_limited": 1}


def test_a_flood_from_one_address_writes_one_lockout_row(make_client, owner_engine):
    c = make_client()  # rl_ip_max = 6
    for i in range(40):
        login(c, f"user{i}", "x")
    counts = dict(sql(owner_engine, "SELECT action, count(*) FROM audit_log GROUP BY action"))
    assert counts == {"login_failed": 6, "login_rate_limited": 1}


# ---- review F3: parallel guesses must not get past the limit ----

def test_parallel_password_guesses_cannot_exceed_the_limit(make_client, add_user):
    import threading
    from concurrent.futures import ThreadPoolExecutor

    add_user()
    n = 16
    clients = [make_client() for _ in range(n)]  # rl_identifier_max = 3
    barrier = threading.Barrier(n)

    def attempt(c):
        barrier.wait()
        return login(c, "alice", "Wrong1!pw").status_code

    with ThreadPoolExecutor(n) as pool:
        codes = list(pool.map(attempt, clients))
    assert codes.count(401) <= 3, codes
    assert codes.count(429) >= n - 3, codes


def test_parallel_guesses_from_one_address_cannot_exceed_the_address_limit(make_client):
    import threading
    from concurrent.futures import ThreadPoolExecutor

    n = 16
    clients = [make_client() for _ in range(n)]  # rl_ip_max = 6, every request uses a fresh name
    barrier = threading.Barrier(n)

    def attempt(args):
        i, c = args
        barrier.wait()
        return login(c, f"nobody{i}", "x").status_code

    with ThreadPoolExecutor(n) as pool:
        codes = list(pool.map(attempt, enumerate(clients)))
    assert codes.count(401) <= 6, codes
