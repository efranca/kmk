import pytest

from helpers import ORIGIN, login, sql


def session(make_client, add_user, username, role):
    add_user(username, f"{username}@example.com", role=role)
    c = make_client()
    token = login(c, username).json()["csrf_token"]
    return c, {**ORIGIN, "X-CSRF-Token": token}


def test_superadmin_reads_defaults(make_client, add_user):
    c, _ = session(make_client, add_user, "root", "superadmin")
    r = c.get("/api/settings/system")
    assert r.status_code == 200
    assert r.json() == {"settings": {"quote_notify_email": "", "quote_from": "", "quote_reply_to": "", "public_phone": ""}}


def test_superadmin_sets_and_reads_back(make_client, add_user):
    c, h = session(make_client, add_user, "root", "superadmin")
    r = c.patch(
        "/api/settings/system",
        json={"quote_from": " KMK Devis <devis@mail.kmk-entretien.com> ", "quote_reply_to": "KMK@Gmail.com", "public_phone": "(418) 555-0100"},
        headers=h,
    )
    assert r.status_code == 200, r.text
    got = c.get("/api/settings/system").json()["settings"]
    assert got["quote_from"] == "KMK Devis <devis@mail.kmk-entretien.com>"
    assert got["quote_reply_to"] == "kmk@gmail.com" and got["public_phone"] == "(418) 555-0100" and got["quote_notify_email"] == ""
    c.patch("/api/settings/system", json={"quote_reply_to": ""}, headers=h)
    assert c.get("/api/settings/system").json()["settings"]["quote_reply_to"] == ""


@pytest.mark.parametrize("role", ["admin", "user"])
def test_only_the_superadmin_may_read_or_change(make_client, add_user, role):
    c, h = session(make_client, add_user, "someone", role)
    assert c.get("/api/settings/system").status_code == 403
    assert c.patch("/api/settings/system", json={"public_phone": "1234567"}, headers=h).status_code == 403


@pytest.mark.parametrize(
    "patch",
    [
        {"quote_reply_to": "nope"},
        {"quote_notify_email": "a@b"},
        {"quote_from": "a\r\nBcc: x@y.zz"},
        {"quote_from": "Name <not-an-address>"},
        {"public_phone": "call me"},
        {"unknown_key": "x"},
    ],
)
def test_invalid_values_are_refused(make_client, add_user, patch):
    c, h = session(make_client, add_user, "root", "superadmin")
    r = c.patch("/api/settings/system", json=patch, headers=h)
    assert r.status_code == 422 and r.json() == {"error": "invalid"}
    assert c.get("/api/settings/system").json()["settings"]["quote_reply_to"] == ""


def test_change_is_audited_without_values(make_client, add_user, owner_engine):
    c, h = session(make_client, add_user, "root", "superadmin")
    c.patch("/api/settings/system", json={"quote_reply_to": "secret.person@gmail.com"}, headers=h)
    rows = sql(owner_engine, "SELECT details::text FROM audit_log WHERE action = 'settings_changed'")
    assert len(rows) == 1 and "quote_reply_to" in rows[0][0] and "secret.person" not in rows[0][0]


def test_a_body_that_is_not_json_is_refused(make_client, add_user):
    c, h = session(make_client, add_user, "root", "superadmin")
    r = c.patch("/api/settings/system", content=b"not json", headers={**h, "Content-Type": "application/json"})
    assert r.status_code == 422 and r.json() == {"error": "invalid"}
