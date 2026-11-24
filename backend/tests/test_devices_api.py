from sqlalchemy import text

from helpers import ORIGIN, login, sql


def sign_in(make_client, add_user, username, role="user", **headers):
    add_user(username, f"{username}@example.com", role=role)
    c = make_client()
    r = login(c, username, headers={**ORIGIN, **headers})
    assert r.status_code == 200
    return c, {**ORIGIN, "X-CSRF-Token": r.json()["csrf_token"]}


def world(make_client, add_user):
    root, rh = sign_in(make_client, add_user, "root", role="superadmin")
    bob, bh = sign_in(make_client, add_user, "bob", role="user")
    bob2 = make_client()
    login(bob2, "bob")
    return root, rh, bob, bh, bob2


def test_only_the_super_admin_may_list(make_client, add_user):
    for username, role in (("al", "admin"), ("ul", "user")):
        c, h = sign_in(make_client, add_user, username, role=role)
        assert c.get("/api/admin/devices").status_code == 403
    assert make_client().get("/api/admin/devices").status_code == 401


def test_listing_groups_sessions_by_person_and_hides_tokens(make_client, add_user):
    root, rh, bob, bh, bob2 = world(make_client, add_user)
    r = root.get("/api/admin/devices")
    assert r.status_code == 200
    groups = {g["user"]["username"]: g["sessions"] for g in r.json()["users"]}
    assert len(groups["bob"]) == 2 and len(groups["root"]) == 1
    assert [s["current"] for s in groups["root"]] == [True]
    assert not any(s["current"] for s in groups["bob"])
    session = groups["bob"][0]
    assert set(session) == {"id", "user_agent", "created_at", "last_seen_at", "ip", "country", "city", "current"}
    assert "token" not in r.text and "token_hash" not in r.text
    assert set(r.json()["users"][0]["user"]) == {"id", "name", "username", "role", "avatar_url"}


def test_revoked_and_expired_sessions_are_not_listed(make_client, add_user, owner_engine):
    root, rh, bob, bh, bob2 = world(make_client, add_user)
    with owner_engine.begin() as c:
        c.execute(text("UPDATE sessions SET revoked_at = now() WHERE id = (SELECT id FROM sessions WHERE user_id = (SELECT id FROM users WHERE username='bob') ORDER BY created_at LIMIT 1)"))
    groups = {g["user"]["username"]: g["sessions"] for g in root.get("/api/admin/devices").json()["users"]}
    assert len(groups["bob"]) == 1
    with owner_engine.begin() as c:
        c.execute(text("UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE user_id = (SELECT id FROM users WHERE username='bob')"))
    groups = {g["user"]["username"]: g["sessions"] for g in root.get("/api/admin/devices").json()["users"]}
    assert "bob" not in groups


def test_revoking_a_device_ends_that_session(make_client, add_user, owner_engine):
    root, rh, bob, bh, bob2 = world(make_client, add_user)
    groups = {g["user"]["username"]: g["sessions"] for g in root.get("/api/admin/devices").json()["users"]}
    target = groups["bob"][0]["id"]
    assert root.delete(f"/api/admin/devices/{target}", headers=rh).status_code == 204
    statuses = sorted([bob.get("/api/auth/me").status_code, bob2.get("/api/auth/me").status_code])
    assert statuses == [200, 401]
    assert sql(owner_engine, "SELECT count(*) FROM audit_log WHERE action = 'session_revoked'")[0][0] == 1


def test_unknown_or_malformed_ids_are_404(make_client, add_user):
    root, rh, *_ = world(make_client, add_user)
    for bad in ("00000000-0000-0000-0000-000000000000", "nope", "1"):
        assert root.delete(f"/api/admin/devices/{bad}", headers=rh).status_code == 404


def test_revoking_requires_the_super_admin_and_csrf(make_client, add_user):
    root, rh, bob, bh, bob2 = world(make_client, add_user)
    target = root.get("/api/admin/devices").json()["users"][0]["sessions"][0]["id"]
    assert bob.delete(f"/api/admin/devices/{target}", headers=bh).status_code == 403
    assert root.delete(f"/api/admin/devices/{target}", headers=ORIGIN).status_code == 403


def test_revoking_ones_own_current_session_logs_out(make_client, add_user):
    root, rh, *_ = world(make_client, add_user)
    mine = root.get("/api/admin/devices").json()["users"]
    own = next(s for g in mine for s in g["sessions"] if s["current"])
    r = root.delete(f"/api/admin/devices/{own['id']}", headers=rh)
    assert r.status_code == 204
    assert root.get("/api/auth/me").status_code == 401


def test_logout_all_ends_every_session_of_a_person(make_client, add_user, owner_engine):
    root, rh, bob, bh, bob2 = world(make_client, add_user)
    uid = sql(owner_engine, "SELECT id FROM users WHERE username = 'bob'")[0][0]
    assert root.post(f"/api/admin/users/{uid}/devices/logout-all", headers=rh).status_code == 204
    assert bob.get("/api/auth/me").status_code == 401 and bob2.get("/api/auth/me").status_code == 401
    assert root.get("/api/auth/me").status_code == 200
    assert sql(owner_engine, "SELECT count(*) FROM audit_log WHERE action = 'sessions_revoked_all'")[0][0] == 1
    assert root.post("/api/admin/users/999999/devices/logout-all", headers=rh).status_code == 404


def test_audit_rows_carry_no_address_or_browser(make_client, add_user, owner_engine):
    root, rh, bob, bh, bob2 = world(make_client, add_user)
    target = root.get("/api/admin/devices").json()["users"][1]["sessions"][0]["id"]
    root.delete(f"/api/admin/devices/{target}", headers=rh)
    rows = sql(owner_engine, "SELECT ip, details::text FROM audit_log WHERE action = 'session_revoked'")
    assert len(rows) == 1
    details = rows[0][1] or ""
    assert "Mozilla" not in details and "testclient" not in details and "." not in details.replace("0.", "")
