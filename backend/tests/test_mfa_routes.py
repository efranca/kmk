import json
import re
import time

import pytest
from sqlalchemy import text

from app import mfa
from helpers import ORIGIN, PW, login, sql, totp

CODE_RE = re.compile(r"^[2-9a-hj-km-np-z]{5}-[2-9a-hj-km-np-z]{5}$")


@pytest.fixture
def clock(monkeypatch):
    state = {"now": time.time()}
    monkeypatch.setattr(mfa, "now", lambda: state["now"])

    class Clock:
        def advance(self, steps: int = 1):
            state["now"] += 30 * steps

    return Clock()


def api(client, path, body, token):
    return client.post(f"/api/auth/mfa/{path}", json=body, headers={**ORIGIN, "X-CSRF-Token": token})


def verified_session(make_client, username, secret, clock, **settings):
    """Logs in with password + current TOTP code; leaves the clock one step later so the next code is fresh."""
    c = make_client(**settings)
    token = login(c, username).json()["csrf_token"]
    assert api(c, "verify", {"code": totp(secret)}, token).status_code == 200
    clock.advance()
    return c, token


def test_enrollment(make_client, add_user, owner_engine, clock):
    add_user()
    c = make_client()
    token = login(c).json()["csrf_token"]
    other = make_client()
    login(other)

    first = api(c, "setup", {}, token)
    assert first.status_code == 200
    body = first.json()
    assert body["otpauth_uri"].startswith("otpauth://totp/") and body["secret"] in body["otpauth_uri"]
    stored, enabled = sql(owner_engine, "SELECT mfa_secret, mfa_enabled FROM users")[0]
    assert enabled is False and stored and body["secret"] not in stored  # encrypted, still pending

    second = api(c, "setup", {}, token).json()
    assert second["secret"] != body["secret"]  # a new pending secret replaces the old one

    assert api(c, "enable", {"code": "000000"}, token).json() == {"error": "invalid_code"}
    assert sql(owner_engine, "SELECT mfa_enabled FROM users")[0][0] is False

    done = api(c, "enable", {"code": totp(second["secret"])}, token)
    assert done.status_code == 200
    codes = done.json()["recovery_codes"]
    assert len(codes) == 10 and all(CODE_RE.match(x) for x in codes)
    assert sql(owner_engine, "SELECT mfa_enabled, mfa_last_step IS NOT NULL FROM users")[0] == (True, True)
    assert sql(owner_engine, "SELECT count(*) FROM recovery_codes")[0][0] == 10
    assert other.get("/api/auth/me").status_code == 401  # other sessions revoked
    me = c.get("/api/auth/me").json()
    assert (me["mfa"], me["mfa_enabled"]) == ("ok", True)  # the enrolling session stays usable

    assert api(c, "setup", {}, token).json() == {"error": "already_enabled"}


def test_enable_without_pending_setup(make_client, add_user):
    add_user()
    c = make_client()
    token = login(c).json()["csrf_token"]
    assert api(c, "enable", {"code": "123456"}, token).json() == {"error": "no_pending_setup"}


def test_verify_input_shape(make_client, add_mfa_user):
    add_mfa_user("alice")
    c = make_client()
    token = login(c, "alice").json()["csrf_token"]
    assert api(c, "verify", {}, token).status_code == 422
    assert api(c, "verify", {"code": "123456", "recovery_code": "abcde-fghjk"}, token).status_code == 422


def test_login_with_totp_window_and_replay(make_client, add_mfa_user, clock):
    secret = add_mfa_user("alice")
    c1, c2 = make_client(), make_client()
    t1, t2 = login(c1, "alice").json()["csrf_token"], login(c2, "alice").json()["csrf_token"]
    assert api(c1, "verify", {"code": "000000"}, t1).json() == {"error": "invalid_code"}
    ok = api(c1, "verify", {"code": totp(secret)}, t1)
    assert (ok.status_code, ok.json()) == (200, {"status": "ok", "recovery_codes_remaining": 10})
    assert c1.get("/api/auth/me").json()["mfa"] == "ok"
    assert api(c2, "verify", {"code": totp(secret)}, t2).json() == {"error": "invalid_code"}  # same step: replay
    clock.advance()
    assert api(c2, "verify", {"code": totp(secret)}, t2).status_code == 200
    assert api(c2, "verify", {"code": totp(secret)}, t2).json() == {"error": "already_verified"}


@pytest.mark.parametrize("offset,accepted", [(-1, True), (1, True), (-2, False), (2, False)])
def test_time_window(make_client, add_mfa_user, clock, offset, accepted):
    secret = add_mfa_user("alice")
    c = make_client()
    token = login(c, "alice").json()["csrf_token"]
    r = api(c, "verify", {"code": totp(secret, offset)}, token)
    assert (r.status_code == 200) is accepted


def test_recovery_codes_work_once_and_loosely(make_client, add_mfa_user):
    add_mfa_user("alice")
    codes = add_mfa_user.codes["alice"]

    def attempt(code):
        c = make_client()
        token = login(c, "alice").json()["csrf_token"]
        return api(c, "verify", {"recovery_code": code}, token)

    first = attempt(codes[0].upper())
    assert (first.status_code, first.json()["recovery_codes_remaining"]) == (200, 9)
    assert attempt(codes[0]).json() == {"error": "invalid_code"}  # single use
    assert attempt(codes[1].replace("-", "")).json()["recovery_codes_remaining"] == 8  # no dash
    assert attempt(" " + codes[2][:5] + " " + codes[2][6:] + " ").json()["recovery_codes_remaining"] == 7  # spaces


def test_regenerate_replaces_the_old_set(make_client, add_mfa_user, clock):
    secret = add_mfa_user("alice")
    old = add_mfa_user.codes["alice"]
    roomy = dict(rl_identifier_max=20, rl_ip_max=20)  # this test fails several checks on purpose
    c, token = verified_session(make_client, "alice", secret, clock, **roomy)
    assert api(c, "recovery-codes/regenerate", {"password": "Wrong1!pw", "code": totp(secret)}, token).json() == {"error": "invalid_current_password"}
    assert api(c, "recovery-codes/regenerate", {"password": PW, "code": "000000"}, token).json() == {"error": "invalid_code"}
    r = api(c, "recovery-codes/regenerate", {"password": PW, "code": totp(secret)}, token)
    new = r.json()["recovery_codes"]
    assert r.status_code == 200 and len(new) == 10 and not set(new) & set(old)

    fresh = make_client(**roomy)
    ftoken = login(fresh, "alice").json()["csrf_token"]
    assert api(fresh, "verify", {"recovery_code": old[5]}, ftoken).json() == {"error": "invalid_code"}
    assert api(fresh, "verify", {"recovery_code": new[0]}, ftoken).status_code == 200


def test_regenerate_needs_totp_enabled(make_client, add_user):
    add_user()
    c = make_client()
    token = login(c).json()["csrf_token"]
    assert api(c, "recovery-codes/regenerate", {"password": PW, "code": "123456"}, token).json() == {"error": "not_enabled"}


def test_disable(make_client, add_mfa_user, owner_engine, clock):
    secret = add_mfa_user("alice")
    c, token = verified_session(make_client, "alice", secret, clock)
    other, _ = verified_session(make_client, "alice", secret, clock)
    assert api(c, "disable", {"password": "Wrong1!pw", "code": totp(secret)}, token).json() == {"error": "invalid_current_password"}
    assert api(c, "disable", {"password": PW, "code": "000000"}, token).json() == {"error": "invalid_code"}
    assert api(c, "disable", {"password": PW, "code": totp(secret)}, token).status_code == 200
    assert sql(owner_engine, "SELECT mfa_enabled, mfa_secret, mfa_last_step FROM users")[0] == (False, None, None)
    assert sql(owner_engine, "SELECT count(*) FROM recovery_codes")[0][0] == 0
    assert other.get("/api/auth/me").status_code == 401
    assert login(make_client(), "alice").json()["mfa"] == "ok"


def test_disable_refused_for_required_roles(make_client, add_mfa_user, clock):
    boss = add_mfa_user("boss", role="admin")
    plain = add_mfa_user("plain")
    settings = dict(mfa_required_roles="admin,superadmin")
    c, token = verified_session(make_client, "boss", boss, clock, **settings)
    r = api(c, "disable", {"password": PW, "code": totp(boss)}, token)
    assert (r.status_code, r.json()) == (403, {"error": "mfa_mandatory"})
    p, ptoken = verified_session(make_client, "plain", plain, clock, **settings)
    assert api(p, "disable", {"password": PW, "code": totp(plain)}, ptoken).status_code == 200


def test_wrong_codes_are_rate_limited_and_audited(make_client, add_mfa_user, owner_engine):
    secret = add_mfa_user("alice")
    c = make_client()
    token = login(c, "alice").json()["csrf_token"]
    for _ in range(3):
        assert api(c, "verify", {"code": "000000"}, token).status_code == 403
    r = api(c, "verify", {"code": totp(secret)}, token)  # even the right code is refused now
    assert (r.status_code, r.json()) == (429, {"error": "too_many_attempts"})
    assert sql(owner_engine, "SELECT count(*) FROM audit_log WHERE action = 'mfa_failed'")[0][0] == 3


def test_without_a_key_mfa_is_unavailable_but_login_works(make_client, add_user, add_mfa_user):
    add_user("plain", "plain@example.com")
    add_mfa_user("secure")
    c = make_client(mfa_encryption_key=None)
    token = login(c, "plain").json()["csrf_token"]
    for path in ("setup", "enable", "verify", "disable", "recovery-codes/regenerate"):
        r = api(c, path, {"code": "123456", "password": PW}, token)
        assert (r.status_code, r.json()) == (503, {"error": "mfa_unavailable"}), path
    assert c.get("/api/auth/me").json()["mfa"] == "ok"
    s = make_client(mfa_encryption_key=None)
    stoken = login(s, "secure").json()["csrf_token"]
    assert api(s, "verify", {"code": "123456"}, stoken).status_code == 503


def test_secrets_never_reach_audit_or_logs(make_client, add_user, owner_engine, clock, caplog):
    import logging

    caplog.set_level(logging.DEBUG)
    add_user()
    c = make_client()
    token = login(c).json()["csrf_token"]
    secret = api(c, "setup", {}, token).json()["secret"]
    used = [totp(secret)]
    codes = api(c, "enable", {"code": used[0]}, token).json()["recovery_codes"]
    clock.advance()
    used.append(totp(secret))
    codes2 = api(c, "recovery-codes/regenerate", {"password": PW, "code": used[1]}, token).json()["recovery_codes"]
    other = make_client()
    otoken = login(other).json()["csrf_token"]
    api(other, "verify", {"recovery_code": codes2[0]}, otoken)
    api(other, "verify", {"code": "999999"}, otoken)
    clock.advance()
    used.append(totp(secret))
    api(c, "disable", {"password": PW, "code": used[2]}, token)

    rows = sql(owner_engine, "SELECT action, details::text FROM audit_log ORDER BY id")
    actions = {r[0] for r in rows}
    assert {"mfa_enrolled", "recovery_codes_regenerated", "mfa_disabled"} <= actions
    blob = json.dumps([list(r) for r in rows]) + caplog.text
    secrets_ = [secret, *used, *codes, *codes2, *(mfa.hash_recovery_code(x) for x in codes + codes2), PW]
    for s in secrets_:
        assert s not in blob, s


def test_verify_and_recovery_login_are_audited(make_client, add_mfa_user, owner_engine):
    secret = add_mfa_user("alice")
    codes = add_mfa_user.codes["alice"]
    c = make_client()
    token = login(c, "alice").json()["csrf_token"]
    api(c, "verify", {"code": totp(secret)}, token)
    d = make_client()
    dtoken = login(d, "alice").json()["csrf_token"]
    api(d, "verify", {"recovery_code": codes[0]}, dtoken)
    actions = [r[0] for r in sql(owner_engine, "SELECT action FROM audit_log WHERE action LIKE 'mfa_%' OR action LIKE 'recovery_%' ORDER BY id")]
    assert actions == ["mfa_verified", "recovery_code_used"]
