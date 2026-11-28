import re
from datetime import datetime

import pytest
from sqlalchemy import text

from app.auth import policy
from helpers import ORIGIN, PW, login, sql

URL = "/api/admin/users"


def signed_in(make_client, add_user, role, username=None, **settings):
    username = username or {"admin": "boss", "superadmin": "root", "user": "plain"}[role]
    add_user(username, f"{username}@example.com", role=role)
    c = make_client(**settings)
    token = login(c, username).json()["csrf_token"]
    return c, {**ORIGIN, "X-CSRF-Token": token}


def uid(owner_engine, username):
    return sql(owner_engine, "SELECT id FROM users WHERE username = :u", u=username)[0][0]


def call(c, h, action, user_id, **extra):
    """One admin action against a user, by policy action name."""
    base = f"{URL}/{user_id}"
    if action == "edit":
        return c.patch(base, json=extra.get("json", {"locale": "en"}), headers=h)
    if action == "set_role":
        return c.post(f"{base}/role", json=extra.get("json", {"role": "admin"}), headers=h)
    path = {
        "resend_invite": "invite",
        "reset_password": "reset",
        "reset_mfa": "reset-mfa",
        "disable": "disable",
        "enable": "enable",
        "delete": "delete",
        "restore": "restore",
        "purge": "purge",
    }[action]
    return c.post(f"{base}/{path}", headers=h)


# ---- the list ----

def test_list_shape_sorting_and_last_sign_in(make_client, add_user, owner_engine):
    c, h = signed_in(make_client, add_user, "admin")
    add_user("zed", "zed@example.com")
    add_user("amy", "amy@example.com", locale="en")
    add_user("gone", "gone@example.com", status="deleted")
    login(make_client(), "amy")
    r = c.get(URL)
    assert r.status_code == 200
    rows = r.json()["users"]
    assert [u["username"] for u in rows] == sorted(u["username"] for u in rows)
    by = {u["username"]: u for u in rows}
    assert {"amy", "boss", "gone", "zed"} <= set(by)  # deleted accounts are listed too
    amy = by["amy"]
    assert set(amy) == {"id", "username", "name", "email", "role", "locale", "status", "mfa_enabled", "created_at", "last_sign_in", "settings", "actions", "avatar_url"}
    assert (amy["locale"], amy["status"], amy["mfa_enabled"]) == ("en", "active", False)
    datetime.fromisoformat(amy["last_sign_in"])
    assert by["zed"]["last_sign_in"] is None
    assert "password_hash" not in r.text and "mfa_secret" not in r.text
    assert by["gone"]["actions"] == ["view", "restore"]


def test_list_gate(make_client, add_user, add_mfa_user):
    assert make_client().get(URL).status_code == 401
    c, _ = signed_in(make_client, add_user, "user")
    assert c.get(URL).status_code == 403
    add_mfa_user("secure", role="admin")
    unverified = make_client()
    login(unverified, "secure")
    r = unverified.get(URL)
    assert (r.status_code, r.json()) == (403, {"error": "mfa_required"})


# ---- the actions advertised by the list equal what the endpoints allow ----

def scenario(reset_db, add_user, add_mfa_user, actor_role, target, status, mfa):
    reset_db()
    add_user("actor", "actor@example.com", role=actor_role)
    if target == "self":
        return "actor"
    role = target
    if mfa and status != "invited":
        add_mfa_user("target", role=role, status=status)
    else:
        add_user("target", "target@example.com", role=role, status=status, password=None if status == "invited" else PW)
    return "target"


SCENARIOS = (
    [("admin", t, s, m) for t in ("user", "admin") for s in ("invited", "active", "disabled", "deleted") for m in (False, True) if not (s == "invited" and m)]
    + [("superadmin", t, s, m) for t in ("user", "admin") for s in ("invited", "active", "disabled", "deleted") for m in (False, True) if not (s == "invited" and m)]
    + [("admin", "superadmin", "active", False), ("admin", "self", "active", False), ("superadmin", "self", "active", False)]
)


@pytest.mark.parametrize("actor_role,target,status,mfa", SCENARIOS)
def test_listed_actions_match_what_the_endpoints_allow(make_client, add_user, add_mfa_user, owner_engine, reset_db, actor_role, target, status, mfa):
    def build():
        name = scenario(reset_db, add_user, add_mfa_user, actor_role, target, status, mfa)
        c = make_client()
        token = login(c, "actor").json()["csrf_token"]
        h = {**ORIGIN, "X-CSRF-Token": token}
        return c, h, uid(owner_engine, name)

    snapshot = "SELECT id, username, role, status, locale, email, mfa_enabled FROM users ORDER BY id"
    c, h, target_id = build()
    row = next(u for u in c.get(URL).json()["users"] if u["id"] == target_id)
    listed = [a for a in row["actions"] if a not in ("view",)]
    before = sql(owner_engine, snapshot)

    def invoke(client, headers, action, target_id):
        if action == "set_role":
            return call(client, headers, action, target_id, json={"role": "user" if row["role"] == "admin" else "admin"})
        return call(client, headers, action, target_id)

    for action in policy.ACTIONS:
        if action == "view" or action in listed:
            continue
        r = invoke(c, h, action, target_id)
        assert r.status_code in (403, 409), (action, r.status_code, r.text)
    assert sql(owner_engine, snapshot) == before  # every refused action left the data untouched
    for action in listed:
        c, h, target_id = build()
        r = invoke(c, h, action, target_id)
        assert 200 <= r.status_code < 300, (action, r.status_code, r.text)


# ---- authority ----

def test_admin_cannot_touch_admins_or_the_superadmin(make_client, add_user, add_mfa_user, owner_engine):
    c, h = signed_in(make_client, add_user, "admin")
    add_user("adm2", "adm2@example.com", role="admin")
    add_mfa_user("mfaadm", role="admin")
    add_user("root", "root@example.com", role="superadmin")
    for name in ("adm2", "mfaadm", "root"):
        for action in ("edit", "resend_invite", "reset_password", "reset_mfa", "disable", "enable", "delete", "restore", "purge", "set_role"):
            r = call(c, h, action, uid(owner_engine, name))
            assert (r.status_code, r.json()) == (403, {"error": "forbidden"}), (name, action)


def test_inviting_admins_is_superadmin_only(make_client, add_user, outbox, owner_engine):
    c, h = signed_in(make_client, add_user, "admin")
    body = {"name": "New Admin", "username": "newadmin", "email": "na@example.com", "locale": "en", "role": "admin"}
    assert c.post(URL, json=body, headers=h).status_code == 403
    assert c.post(URL, json={**body, "role": "superadmin"}, headers=h).status_code == 422
    assert c.post(URL, json={**body, "role": "user"}, headers=h).json()["user"]["role"] == "user"
    root_c, root_h = signed_in(make_client, add_user, "superadmin")
    r = root_c.post(URL, json={**body, "username": "newadmin2", "email": "na2@example.com"}, headers=root_h)
    assert r.status_code == 201 and r.json()["user"]["role"] == "admin"
    assert tuple(sql(owner_engine, "SELECT role, status FROM users WHERE username = 'newadmin2'")[0]) == ("admin", "invited")
    audit = sql(owner_engine, "SELECT details::text FROM audit_log WHERE action = 'user_invited' ORDER BY id")
    assert '"role": "admin"' in audit[-1][0]
    assert root_c.post(URL, json={**body, "username": "x1x", "email": "x@example.com", "role": "superadmin"}, headers=root_h).status_code == 422


def test_nobody_destroys_themselves(make_client, add_user, owner_engine):
    c, h = signed_in(make_client, add_user, "admin")
    me = uid(owner_engine, "boss")
    for action in ("disable", "delete", "set_role", "reset_mfa"):
        r = call(c, h, action, me)
        assert (r.status_code, r.json()) == (403, {"error": "cannot_target_self"}), action
    root_c, root_h = signed_in(make_client, add_user, "superadmin")
    root = uid(owner_engine, "root")
    for action in ("disable", "delete", "set_role", "reset_mfa"):
        assert call(root_c, root_h, action, root).json() == {"error": "cannot_target_self"}, action


def test_admins_and_the_superadmin_can_reset_their_own_password(make_client, add_user, outbox, owner_engine):
    c, h = signed_in(make_client, add_user, "admin")
    r = call(c, h, "reset_password", uid(owner_engine, "boss"))
    assert (r.status_code, r.json()) == (202, {"status": "ok"})
    root_c, root_h = signed_in(make_client, add_user, "superadmin")
    assert call(root_c, root_h, "reset_password", uid(owner_engine, "root")).status_code == 202
    assert [m.to for m in outbox] == ["boss@example.com", "root@example.com"]
    # ...but an admin still cannot reset another admin's password
    add_user("adm2", "adm2@example.com", role="admin")
    assert call(c, h, "reset_password", uid(owner_engine, "adm2")).status_code == 403


# ---- lifecycle effects ----

def test_disable_then_enable(make_client, add_user, owner_engine):
    c, h = signed_in(make_client, add_user, "admin")
    add_user("bob", "bob@example.com")
    add_user("fresh", "fresh@example.com", password=None, status="invited")
    bob = make_client()
    login(bob, "bob")
    assert bob.get("/api/auth/me").status_code == 200
    assert call(c, h, "disable", uid(owner_engine, "bob")).status_code == 200
    assert bob.get("/api/auth/me").status_code == 401  # the open session died at once
    assert login(make_client(), "bob").json() == {"error": "invalid_credentials"}
    assert call(c, h, "enable", uid(owner_engine, "bob")).status_code == 200
    assert login(make_client(), "bob").status_code == 200
    call(c, h, "disable", uid(owner_engine, "fresh"))
    call(c, h, "enable", uid(owner_engine, "fresh"))
    assert sql(owner_engine, "SELECT status FROM users WHERE username = 'fresh'")[0][0] == "invited"


def test_delete_keeps_identity_reserved_and_restore_works(make_client, add_user, make_token, owner_engine):
    c, h = signed_in(make_client, add_user, "admin")
    add_user("bob", "bob@example.com")
    bob = make_client()
    login(bob, "bob")
    token = make_token("bob", "reset")
    assert call(c, h, "delete", uid(owner_engine, "bob")).status_code == 200
    assert bob.get("/api/auth/me").status_code == 401
    anon = make_client()
    assert anon.post("/api/auth/set-password", json={"token": token, "password": "Newpass1!"}, headers=ORIGIN).status_code == 400
    body = {"name": "Bob Reserved", "username": "bob", "email": "other@example.com", "locale": "en"}
    assert c.post(URL, json=body, headers=h).status_code == 409  # username stays reserved
    assert c.post(URL, json={**body, "username": "bob2", "email": "bob@example.com"}, headers=h).status_code == 409  # so does the email
    assert call(c, h, "restore", uid(owner_engine, "bob")).status_code == 200
    assert sql(owner_engine, "SELECT status, deleted_at IS NULL FROM users WHERE username = 'bob'")[0] == ("disabled", True)
    assert login(make_client(), "bob").status_code == 401  # restored accounts start disabled
    call(c, h, "enable", uid(owner_engine, "bob"))
    assert login(make_client(), "bob").status_code == 200


def test_role_change(make_client, add_user, owner_engine):
    root_c, root_h = signed_in(make_client, add_user, "superadmin")
    add_user("usr", "usr@example.com")
    usr = make_client()
    login(usr, "usr")
    r = call(root_c, root_h, "set_role", uid(owner_engine, "usr"), json={"role": "admin"})
    assert (r.status_code, r.json()["user"]["role"]) == (200, "admin")
    assert usr.get("/api/auth/me").status_code == 401  # sessions are revoked on a role change
    usr2 = make_client()
    login(usr2, "usr")
    assert usr2.get(URL).status_code == 200  # now an admin
    r = call(root_c, root_h, "set_role", uid(owner_engine, "usr"), json={"role": "user"})
    assert r.json()["user"]["role"] == "user"
    assert usr2.get(URL).status_code == 401  # session revoked again
    assert call(root_c, root_h, "set_role", uid(owner_engine, "usr"), json={"role": "superadmin"}).status_code == 422
    admin_c, admin_h = signed_in(make_client, add_user, "admin")
    assert call(admin_c, admin_h, "set_role", uid(owner_engine, "usr"), json={"role": "admin"}).status_code == 403


def test_reset_mfa(make_client, add_user, add_mfa_user, owner_engine):
    c, h = signed_in(make_client, add_user, "admin")
    add_mfa_user("m")
    add_user("plain2", "plain2@example.com")
    add_user("root", "root@example.com", role="superadmin")
    m = make_client()
    login(m, "m")
    r = call(c, h, "reset_mfa", uid(owner_engine, "m"))
    assert (r.status_code, r.json()) == (200, {"status": "ok"})
    assert m.get("/api/auth/me").status_code == 401
    assert sql(owner_engine, "SELECT count(*) FROM recovery_codes")[0][0] == 0
    assert tuple(sql(owner_engine, "SELECT mfa_enabled, mfa_secret FROM users WHERE username = 'm'")[0]) == (False, None)
    row = sql(owner_engine, "SELECT actor_user_id, details::text FROM audit_log WHERE action = 'mfa_reset'")[0]
    assert row[0] == uid(owner_engine, "boss") and '"admin"' in row[1]
    assert call(c, h, "reset_mfa", uid(owner_engine, "plain2")).json() == {"error": "not_enabled"}
    assert call(c, h, "reset_mfa", uid(owner_engine, "root")).status_code == 403


def test_edit_rules(make_client, add_user, owner_engine):
    c, h = signed_in(make_client, add_user, "admin")
    add_user("act", "act@example.com")
    add_user("inv", "inv@example.com", password=None, status="invited")
    add_user("taken", "taken@example.com")
    ok = call(c, h, "edit", uid(owner_engine, "act"), json={"locale": "pt-BR"})
    assert (ok.status_code, ok.json()["user"]["locale"]) == (200, "pt-BR")
    ok = call(c, h, "edit", uid(owner_engine, "inv"), json={"email": "NEW@Example.com", "locale": "en"})
    assert ok.status_code == 200 and ok.json()["user"]["email"] == "new@example.com"
    assert call(c, h, "edit", uid(owner_engine, "act"), json={"email": "x@example.com"}).json() == {"error": "invalid_state"}
    assert call(c, h, "edit", uid(owner_engine, "inv"), json={"email": "TAKEN@example.com"}).json() == {"error": "already_exists"}
    assert call(c, h, "edit", uid(owner_engine, "act"), json={}).status_code == 422
    assert call(c, h, "edit", uid(owner_engine, "act"), json={"email": "not-an-email"}).status_code == 422
    assert call(c, h, "edit", 99999, json={"locale": "en"}).status_code == 404


def test_audit_events(make_client, add_user, add_mfa_user, owner_engine):
    c, h = signed_in(make_client, add_user, "admin")
    root_c, root_h = signed_in(make_client, add_user, "superadmin")
    add_user("bob", "bob@example.com")
    add_mfa_user("mia")
    add_user("inv", "inv@example.com", password=None, status="invited")
    bob, mia, inv = uid(owner_engine, "bob"), uid(owner_engine, "mia"), uid(owner_engine, "inv")
    for action in ("disable", "enable", "delete", "restore"):
        assert call(c, h, action, bob).status_code == 200
    call(c, h, "edit", inv, json={"email": "changed@example.com", "locale": "en"})
    call(c, h, "reset_mfa", mia)
    call(root_c, root_h, "set_role", bob, json={"role": "admin"})
    rows = sql(owner_engine, "SELECT action, actor_user_id, target_user_id, details::text FROM audit_log ORDER BY id")
    got = {r[0]: r for r in rows if r[0].startswith(("user_", "mfa_"))}
    boss, root = uid(owner_engine, "boss"), uid(owner_engine, "root")
    for action in ("user_disabled", "user_enabled", "user_deleted", "user_restored"):
        assert (got[action][1], got[action][2]) == (boss, bob), action
    assert (got["user_updated"][1], got["user_updated"][2]) == (boss, inv)
    assert '"fields"' in got["user_updated"][3] and "locale" in got["user_updated"][3] and "email" in got["user_updated"][3]
    assert (got["user_role_changed"][1], got["user_role_changed"][2]) == (root, bob)
    assert '"from": "user"' in got["user_role_changed"][3] and '"to": "admin"' in got["user_role_changed"][3]
    assert (got["mfa_reset"][1], got["mfa_reset"][2]) == (boss, mia)
    assert "@" not in "".join(r[3] or "" for r in rows)  # no email addresses in any audit details


def test_a_lone_admin_can_still_be_disabled_by_the_superadmin(make_client, add_user, owner_engine):
    # The last-admin invariant is defensive (the super admin is always an active privileged user); it must not misfire.
    root_c, root_h = signed_in(make_client, add_user, "superadmin")
    add_user("solo", "solo@example.com", role="admin")
    assert call(root_c, root_h, "disable", uid(owner_engine, "solo")).status_code == 200
    assert call(root_c, root_h, "delete", uid(owner_engine, "solo")).status_code == 200


def test_correcting_an_invited_email_kills_the_first_invite_link(make_client, add_user, outbox, owner_engine):
    c, h = admin_client_for_lifecycle(make_client, add_user)
    created = c.post(URL, json={"name": "Marie Tremblay", "username": "marie", "email": "marie@gmial.com", "locale": "fr-CA"}, headers=h)
    assert created.status_code == 201
    first = re.search(r"#token=([^&\s]+)", outbox[0].text).group(1)
    uid_marie = created.json()["user"]["id"]
    assert c.patch(f"{URL}/{uid_marie}", json={"email": "marie@gmail.com"}, headers=h).status_code == 200
    anon = make_client()
    stranger = anon.post("/api/auth/set-password", json={"token": first, "password": "Newpass1!"}, headers=ORIGIN)
    assert (stranger.status_code, stranger.json()) == (400, {"error": "invalid_token"})  # the stranger at gmial.com is locked out
    assert c.post(f"{URL}/{uid_marie}/invite", headers=h).status_code == 202  # the admin re-sends to the corrected address
    assert outbox[-1].to == "marie@gmail.com"
    second = re.search(r"#token=([^&\s]+)", outbox[-1].text).group(1)
    assert anon.post("/api/auth/set-password", json={"token": second, "password": "Newpass1!"}, headers=ORIGIN).status_code == 200


def admin_client_for_lifecycle(make_client, add_user):
    return signed_in(make_client, add_user, "admin")


def test_takeover_playbook_disable_reset_password_then_enable(make_client, add_user, outbox, owner_engine):
    """Review F2: the account stays locked out until the real owner has set a new password; only then is it enabled."""
    c, h = admin_client_for_lifecycle(make_client, add_user)
    add_user("bob", "bob@example.com")  # password PW, possibly known to an attacker
    bob_id = uid(owner_engine, "bob")
    attacker = make_client()
    assert login(attacker, "bob").status_code == 200  # the attacker is in with the stolen password
    assert call(c, h, "disable", bob_id).status_code == 200
    assert attacker.get("/api/auth/me").status_code == 401
    r = call(c, h, "reset_password", bob_id)  # allowed while disabled
    assert (r.status_code, r.json()) == (202, {"status": "ok"})
    token = re.search(r"#token=([^&\s]+)", outbox[-1].text).group(1)
    owner = make_client()
    assert owner.post("/api/auth/set-password", json={"token": token, "password": "Brandnew1!"}, headers=ORIGIN).status_code == 200
    assert sql(owner_engine, "SELECT status FROM users WHERE username = 'bob'")[0][0] == "disabled"  # NOT re-enabled by the link
    assert login(make_client(), "bob", "Brandnew1!").status_code == 401  # still locked out until an admin enables
    assert call(c, h, "enable", bob_id).status_code == 200
    assert login(make_client(), "bob", PW).status_code == 401  # the attacker's password no longer works
    assert login(make_client(), "bob", "Brandnew1!").status_code == 200


# ======================= a name for every person =======================

def invite(c, h, **kw):
    body = {"name": "Marie Tremblay", "username": "marie", "email": "marie@example.com", "locale": "fr-CA", **kw}
    body = {k: v for k, v in body.items() if v is not None}
    return c.post(URL, json=body, headers=h)


def test_invitation_requires_a_valid_name(make_client, add_user, outbox, owner_engine):
    c, h = admin_client_for_lifecycle(make_client, add_user)
    for bad in (None, "", "   ", "x" * 101, "<b>Marie</b>", "Marie\nTremblay", "Marie\u202eT", "m@x.com"):
        r = invite(c, h, name=bad)
        assert r.status_code == 422, repr(bad)
    assert sql(owner_engine, "SELECT count(*) FROM users WHERE username = 'marie'")[0][0] == 0
    assert outbox == []


def test_the_name_is_cleaned_stored_and_returned(make_client, add_user, outbox, owner_engine):
    c, h = admin_client_for_lifecycle(make_client, add_user)
    r = invite(c, h, name="  Élise   Gagnon ")
    assert r.status_code == 201 and r.json()["user"]["name"] == "Élise Gagnon"
    assert sql(owner_engine, "SELECT name FROM users WHERE username = 'marie'")[0][0] == "Élise Gagnon"
    rows = {u["username"]: u for u in c.get(URL).json()["users"]}
    assert rows["marie"]["name"] == "Élise Gagnon" and rows["boss"]["name"] is None


def test_the_list_is_sorted_by_name_ignoring_accents_and_capitals(make_client, add_user, owner_engine):
    c, h = admin_client_for_lifecycle(make_client, add_user)  # "boss", no name
    for username, name in (("u1", "Zoé Roy"), ("u2", "émile Côté"), ("u3", "anne Bélanger"), ("u4", None)):
        add_user(username, f"{username}@example.com")
        if name:
            sql(owner_engine, "UPDATE users SET name = :n WHERE username = :u", n=name, u=username)
    order = [u["username"] for u in c.get(URL).json()["users"]]
    # anne, boss (no name: sorted by username), émile, u4 (no name), Zoé
    assert order == ["u3", "boss", "u2", "u4", "u1"]


def test_admins_and_the_superadmin_can_edit_names_within_their_authority(make_client, add_user, owner_engine):
    add_user("plain1", "p1@example.com")
    add_user("adm2", "adm2@example.com", role="admin")
    c, h = admin_client_for_lifecycle(make_client, add_user)
    ok = call(c, h, "edit", uid(owner_engine, "plain1"), json={"name": "Pat Plain"})
    assert (ok.status_code, ok.json()["user"]["name"]) == (200, "Pat Plain")
    assert call(c, h, "edit", uid(owner_engine, "adm2"), json={"name": "Nope"}).status_code == 403  # an admin cannot edit an admin
    assert call(c, h, "edit", uid(owner_engine, "boss"), json={"name": "Nope"}).status_code == 403  # nor themselves
    root_c, root_h = signed_in(make_client, add_user, "superadmin")
    for name, new in (("plain1", "Pat P."), ("adm2", "Adam Admin"), ("root", "Rita Root")):  # everyone, including themselves
        r = call(root_c, root_h, "edit", uid(owner_engine, name), json={"name": new})
        assert (r.status_code, r.json()["user"]["name"]) == (200, new), name
    plain_c, plain_h = signed_in(make_client, add_user, "user", "plain9")
    assert call(plain_c, plain_h, "edit", uid(owner_engine, "plain1"), json={"name": "X"}).status_code == 403
    assert call(root_c, root_h, "edit", uid(owner_engine, "plain1"), json={"name": "<i>x</i>"}).status_code == 422
    assert call(root_c, root_h, "edit", uid(owner_engine, "plain1"), json={}).status_code == 422


def test_the_super_admin_still_cannot_disable_delete_or_re_role_themselves(make_client, add_user, owner_engine):
    root_c, root_h = signed_in(make_client, add_user, "superadmin")
    me = uid(owner_engine, "root")
    for action in ("disable", "delete", "set_role", "reset_mfa"):
        assert call(root_c, root_h, action, me).json() == {"error": "cannot_target_self"}, action


def test_a_name_edit_is_audited_without_the_name(make_client, add_user, owner_engine, outbox, caplog):
    # (outbox replaces the development email backend, which prints whole messages, links and names included, by design)
    import logging

    caplog.set_level(logging.DEBUG)
    add_user("plain1", "p1@example.com")
    c, h = admin_client_for_lifecycle(make_client, add_user)
    secret_name = "Qwertyuiop Zxcvbnm"
    invite(c, h, name=secret_name)
    call(c, h, "edit", uid(owner_engine, "plain1"), json={"name": secret_name + " Jr"})
    rows = sql(owner_engine, "SELECT action, details::text FROM audit_log ORDER BY id")
    blob = "".join(f"{a} {d}" for a, d in rows) + caplog.text
    assert "Qwertyuiop" not in blob and "Zxcvbnm" not in blob  # no name anywhere in audit rows or logs
    updated = [d for a, d in rows if a == "user_updated"]
    assert updated and '"name"' in updated[-1]  # the field name is recorded


# ---- delete for good (super admin only) ----

def test_only_the_superadmin_deletes_a_person_for_good(make_client, add_user, owner_engine):
    c, h = signed_in(make_client, add_user, "admin")
    root_c, root_h = signed_in(make_client, add_user, "superadmin")
    add_user("bob", "bob@example.com")
    add_user("adm2", "adm2@example.com", role="admin")
    bob, adm2 = uid(owner_engine, "bob"), uid(owner_engine, "adm2")
    assert call(c, h, "purge", bob).status_code == 403  # an admin cannot, even on a plain user
    assert call(root_c, root_h, "purge", bob).json() == {"error": "invalid_state"}  # only an account already deleted
    assert call(root_c, root_h, "delete", bob).status_code == 200
    assert "purge" in next(u for u in root_c.get(URL).json()["users"] if u["id"] == bob)["actions"]
    assert "purge" not in next(u for u in c.get(URL).json()["users"] if u["id"] == bob)["actions"]
    assert call(c, h, "purge", bob).status_code == 403
    assert call(root_c, root_h, "purge", bob).status_code == 200
    assert sql(owner_engine, "SELECT count(*) FROM users WHERE username = 'bob'")[0][0] == 0
    assert sql(owner_engine, "SELECT count(*) FROM audit_log WHERE action = 'user_purged'")[0][0] == 1
    assert call(root_c, root_h, "delete", adm2).status_code == 200
    assert call(root_c, root_h, "purge", adm2).status_code == 200  # a deleted admin too (only the super admin can)
    assert call(root_c, root_h, "purge", uid(owner_engine, "root")).json() == {"error": "cannot_target_self"}


def test_purging_a_person_keeps_what_they_made(make_client, add_user, owner_engine):
    root_c, root_h = signed_in(make_client, add_user, "superadmin")
    add_user("bob", "bob@example.com", role="admin")
    bob = uid(owner_engine, "bob")
    sql(owner_engine, "INSERT INTO task_categories (name, created_by) VALUES ('Keep', :u)", u=bob)
    sql(owner_engine, "INSERT INTO document_categories (name, created_by) VALUES ('Keep', :u)", u=bob)
    assert call(root_c, root_h, "delete", bob).status_code == 200
    assert call(root_c, root_h, "purge", bob).status_code == 200
    assert sql(owner_engine, "SELECT created_by FROM task_categories WHERE name = 'Keep'")[0][0] is None
