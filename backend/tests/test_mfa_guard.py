import re

from helpers import ORIGIN, PW, login, sql

PUBLIC = {
    ("GET", "/api/health"),
    ("POST", "/api/auth/login"),
    ("POST", "/api/auth/forgot-password"),
    ("POST", "/api/auth/set-password"),
}
# What a session in the "verify" state may still call.
VERIFY_ALLOWED = {("GET", "/api/auth/me"), ("POST", "/api/auth/logout"), ("POST", "/api/auth/mfa/verify")}
# What a session in the "setup" state (enforcement on, no TOTP yet) may still call.
SETUP_ALLOWED = {
    ("GET", "/api/auth/me"),
    ("POST", "/api/auth/logout"),
    ("POST", "/api/auth/mfa/setup"),
    ("POST", "/api/auth/mfa/enable"),
}


def protected_routes(client):
    """Every (METHOD, path) the app serves under /api, from the generated API description."""
    paths = client.app.openapi()["paths"]
    return sorted((method.upper(), path) for path, methods in paths.items() if path.startswith("/api") for method in methods)


def call(client, method, path, token):
    url = re.sub(r"\{[^}]+\}", "1", path)
    return client.request(method, url, json={}, headers={**ORIGIN, "X-CSRF-Token": token})


def test_login_and_me_report_the_state(client, add_user, add_mfa_user, owner_engine):
    add_user("plain", "plain@example.com")
    add_mfa_user("secure")
    body = login(client, "plain").json()
    assert (body["mfa"], body["mfa_enabled"]) == ("ok", False)
    me = client.get("/api/auth/me").json()
    assert (me["mfa"], me["mfa_enabled"]) == ("ok", False)
    other = login(client, "secure").json()
    assert (other["mfa"], other["mfa_enabled"]) == ("verify", True)
    assert client.get("/api/auth/me").json()["mfa"] == "verify"
    flags = sql(owner_engine, "SELECT u.username, s.mfa_verified FROM sessions s JOIN users u ON u.id = s.user_id ORDER BY s.created_at")
    assert [tuple(r) for r in flags] == [("plain", True), ("secure", False)]


def test_verify_state_blocks_every_protected_route(client, add_mfa_user):
    add_mfa_user("secure")
    token = login(client, "secure").json()["csrf_token"]
    routes = protected_routes(client)
    checked = 0
    for method, path in routes:
        if (method, path) in PUBLIC or (method, path) in VERIFY_ALLOWED:
            continue
        r = call(client, method, path, token)
        assert (r.status_code, r.json()) == (403, {"error": "mfa_required"}), (method, path)
        checked += 1
    assert checked >= 4  # change-password and the admin routes at least: never passes vacuously


def test_verify_state_can_still_read_me_and_logout(client, add_mfa_user):
    add_mfa_user("secure")
    token = login(client, "secure").json()["csrf_token"]
    assert client.get("/api/auth/me").status_code == 200
    assert client.post("/api/auth/logout", headers={**ORIGIN, "X-CSRF-Token": token}).status_code == 204


def test_setup_state_with_enforcement(make_client, add_user):
    add_user("boss", "boss@example.com", role="admin")
    add_user("plain", "plain@example.com")
    c = make_client(mfa_required_roles="admin,superadmin")
    body = login(c, "boss").json()
    assert (body["mfa"], body["mfa_enabled"]) == ("setup", False)
    assert c.get("/api/auth/me").json()["mfa"] == "setup"
    checked = 0
    for method, path in protected_routes(c):
        if (method, path) in PUBLIC or (method, path) in SETUP_ALLOWED:
            continue
        r = call(c, method, path, body["csrf_token"])
        assert (r.status_code, r.json()) == (403, {"error": "mfa_setup_required"}), (method, path)
        checked += 1
    assert checked >= 4
    assert login(make_client(mfa_required_roles="admin,superadmin"), "plain").json()["mfa"] == "ok"
    assert c.post("/api/auth/logout", headers={**ORIGIN, "X-CSRF-Token": body["csrf_token"]}).status_code == 204


def test_default_settings_force_nobody(client, add_user, outbox):
    add_user("boss", "boss@example.com", role="admin")
    body = login(client, "boss").json()
    assert (body["mfa"], body["mfa_enabled"]) == ("ok", False)
    h = {**ORIGIN, "X-CSRF-Token": body["csrf_token"]}
    created = client.post("/api/admin/users", json={"name": "New One", "username": "newone", "email": "n@example.com", "locale": "en"}, headers=h)
    assert created.status_code == 201
    changed = client.post("/api/auth/change-password", json={"current_password": PW, "new_password": "Another1!"}, headers=h)
    assert changed.status_code == 200
