import pytest

from helpers import ORIGIN, login, sql

JPEG = b"\xff\xd8\xff\xe0" + b"j" * 200
PNG = b"\x89PNG\r\n\x1a\n" + b"p" * 200
WEBP = b"RIFF\x10\x00\x00\x00WEBP" + b"w" * 200


def session(make_client, add_user, username="alice", role="user"):
    add_user(username, f"{username}@example.com", role=role)
    c = make_client()
    r = login(c, username)
    return c, {**ORIGIN, "X-CSRF-Token": r.json()["csrf_token"]}


def uid(owner_engine, username):
    return sql(owner_engine, "SELECT id FROM users WHERE username = :u", u=username)[0][0]


def put(c, h, data, ctype="image/jpeg"):
    return c.put("/api/me/avatar", content=data, headers={**h, "Content-Type": ctype})


@pytest.mark.parametrize("data,ctype", [(JPEG, "image/jpeg"), (PNG, "image/png"), (WEBP, "image/webp")])
def test_accepts_the_three_formats_and_serves_them_back(make_client, add_user, owner_engine, data, ctype):
    c, h = session(make_client, add_user)
    assert put(c, h, data, ctype).status_code == 204
    r = c.get(f"/api/people/{uid(owner_engine, 'alice')}/avatar")
    assert r.status_code == 200 and r.content == data
    assert r.headers["content-type"] == ctype
    assert r.headers["x-content-type-options"] == "nosniff"
    assert "sandbox" in r.headers["content-security-policy"]
    assert "must-revalidate" in r.headers["cache-control"] and r.headers["etag"]


def test_etag_gives_304(make_client, add_user, owner_engine):
    c, h = session(make_client, add_user)
    put(c, h, JPEG)
    url = f"/api/people/{uid(owner_engine, 'alice')}/avatar"
    etag = c.get(url).headers["etag"]
    assert c.get(url, headers={"If-None-Match": etag}).status_code == 304


def test_replace_keeps_one_row(make_client, add_user, owner_engine):
    c, h = session(make_client, add_user)
    put(c, h, JPEG)
    put(c, h, PNG, "image/png")
    assert sql(owner_engine, "SELECT count(*) FROM user_avatars")[0][0] == 1
    assert sql(owner_engine, "SELECT content_type FROM user_avatars")[0][0] == "image/png"


@pytest.mark.parametrize(
    "data",
    [b"", b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>", b"<html></html>", b"GIF89a" + b"g" * 50, JPEG + b"x" * 51200],
)
def test_bad_bodies_are_422(make_client, add_user, data):
    c, h = session(make_client, add_user)
    r = put(c, h, data)
    assert r.status_code == 422 and r.json() == {"error": "invalid_image"}


def test_html_renamed_as_an_image_is_refused(make_client, add_user):
    c, h = session(make_client, add_user)
    assert put(c, h, b"<script>alert(1)</script>", "image/jpeg").status_code == 422


def test_exactly_50kb_is_accepted(make_client, add_user):
    c, h = session(make_client, add_user)
    assert put(c, h, JPEG + b"x" * (51200 - len(JPEG))).status_code == 204


def test_avatar_url_appears_in_people_me_and_admin_list(make_client, add_user, owner_engine):
    c, h = session(make_client, add_user)
    me_id = uid(owner_engine, "alice")
    assert c.get("/api/auth/me").json()["user"]["avatar_url"] is None
    put(c, h, JPEG)
    url = c.get("/api/auth/me").json()["user"]["avatar_url"]
    assert url.startswith(f"/api/people/{me_id}/avatar?v=")
    mine = [p for p in c.get("/api/schedule/people").json()["people"] if p["id"] == me_id][0]
    assert mine["avatar_url"] == url


def test_delete_own(make_client, add_user, owner_engine):
    c, h = session(make_client, add_user)
    put(c, h, JPEG)
    assert c.delete("/api/me/avatar", headers=h).status_code == 204
    assert c.get(f"/api/people/{uid(owner_engine, 'alice')}/avatar").status_code == 404
    assert c.get("/api/auth/me").json()["user"]["avatar_url"] is None


def test_get_needs_a_session(make_client, add_user, owner_engine):
    c, h = session(make_client, add_user)
    put(c, h, JPEG)
    assert make_client().get(f"/api/people/{uid(owner_engine, 'alice')}/avatar").status_code == 401


def test_plain_user_cannot_remove_anothers(make_client, add_user, owner_engine):
    a, ha = session(make_client, add_user, "alice")
    put(a, ha, JPEG)
    b, hb = session(make_client, add_user, "bob")
    assert b.delete(f"/api/admin/users/{uid(owner_engine, 'alice')}/avatar", headers=hb).status_code == 403
    assert sql(owner_engine, "SELECT count(*) FROM user_avatars")[0][0] == 1


def test_admin_can_remove_a_plain_users_but_not_an_admins(make_client, add_user, owner_engine):
    a, ha = session(make_client, add_user, "alice")
    put(a, ha, JPEG)
    boss, hb = session(make_client, add_user, "boss", role="admin")
    other, ho = session(make_client, add_user, "other", role="admin")
    put(other, ho, PNG, "image/png")
    assert boss.delete(f"/api/admin/users/{uid(owner_engine, 'other')}/avatar", headers=hb).status_code == 403
    assert boss.delete(f"/api/admin/users/{uid(owner_engine, 'alice')}/avatar", headers=hb).status_code == 204
    assert sql(owner_engine, "SELECT count(*) FROM user_avatars WHERE user_id = :u", u=uid(owner_engine, "alice"))[0][0] == 0


def test_audit_rows_have_no_content(make_client, add_user, owner_engine):
    c, h = session(make_client, add_user)
    put(c, h, JPEG)
    c.delete("/api/me/avatar", headers=h)
    rows = sql(owner_engine, "SELECT action, details FROM audit_log WHERE action IN ('avatar_set', 'avatar_removed') ORDER BY id")
    assert [r[0] for r in rows] == ["avatar_set", "avatar_removed"]
    assert "jjjj" not in str(rows)


def test_deleting_an_account_takes_its_picture_down(make_client, add_user, owner_engine):
    a, ha = session(make_client, add_user, "alice")
    put(a, ha, JPEG)
    boss, hb = session(make_client, add_user, "boss", role="admin")
    alice_id = uid(owner_engine, "alice")
    assert boss.post(f"/api/admin/users/{alice_id}/delete", headers=hb).status_code == 200
    assert sql(owner_engine, "SELECT count(*) FROM user_avatars")[0][0] == 0
    assert boss.get(f"/api/people/{alice_id}/avatar").status_code == 404
    people = {p["id"]: p for p in boss.get("/api/schedule/people").json()["people"]}
    assert people[alice_id]["avatar_url"] is None
