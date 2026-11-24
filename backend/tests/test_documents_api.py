import pytest
from sqlalchemy import text

from helpers import ORIGIN, login, sql

ROLES = ("user", "admin", "superadmin")


def sign_in(make_client, add_user, username, role):
    add_user(username, f"{username}@example.com", role=role)
    c = make_client()
    r = login(c, username)
    assert r.status_code == 200
    return c, {**ORIGIN, "X-CSRF-Token": r.json()["csrf_token"]}


@pytest.fixture
def team(make_client, add_user):
    return {role: sign_in(make_client, add_user, role + "1", role) for role in ROLES}


def add_visible(owner_engine, title, visibility, creator="admin1"):
    """A finished document (with a file) put straight into the database."""
    with owner_engine.begin() as c:
        uid = c.execute(text("SELECT id FROM users WHERE username = :u"), dict(u=creator)).scalar()
        did = c.execute(
            text("INSERT INTO documents (title, visibility, created_by, updated_by, file_name, content_type, size_bytes) "
                 "VALUES (:t, :v, :u, :u, 'a.pdf', 'application/pdf', 5) RETURNING id"),
            dict(t=title, v=visibility, u=uid),
        ).scalar()
        c.execute(text("INSERT INTO document_files (document_id, data) VALUES (:d, :b)"), dict(d=did, b=b"%PDF-"))
    return did


def titles(client):
    return sorted(d["title"] for d in client.get("/api/documents").json()["documents"])


def test_each_role_lists_only_its_levels(team, owner_engine):
    team  # users exist
    for level in ("everyone", "admins", "superadmin"):
        add_visible(owner_engine, level, level)
    assert titles(team["user"][0]) == ["everyone"]
    assert titles(team["admin"][0]) == ["admins", "everyone"]
    assert titles(team["superadmin"][0]) == ["admins", "everyone", "superadmin"]


@pytest.mark.parametrize(
    "role, level, visible",
    [("user", "everyone", True), ("user", "admins", False), ("user", "superadmin", False),
     ("admin", "admins", True), ("admin", "superadmin", False), ("superadmin", "superadmin", True)],
)
def test_get_patch_delete_answer_404_for_what_you_may_not_see(team, owner_engine, role, level, visible):
    did = add_visible(owner_engine, "d", level)
    c, h = team[role]
    assert c.get(f"/api/documents/{did}").status_code == (200 if visible else 404)
    if role != "user":
        assert c.patch(f"/api/documents/{did}", json={"title": "x"}, headers=h).status_code == (200 if visible else 404)
        assert c.delete(f"/api/documents/{did}", headers=h).status_code == (204 if visible else 404)
    else:
        assert c.patch(f"/api/documents/{did}", json={"title": "x"}, headers=h).status_code == 403


def test_a_missing_document_looks_the_same_as_a_hidden_one(team, owner_engine):
    did = add_visible(owner_engine, "d", "superadmin")
    user, _ = team["user"]
    hidden, missing = user.get(f"/api/documents/{did}"), user.get("/api/documents/999999")
    assert hidden.status_code == missing.status_code == 404 and hidden.json() == missing.json()


def test_bad_ids_are_404_not_500(team):
    admin, h = team["admin"]
    assert admin.get("/api/documents/0").status_code == 422 or admin.get("/api/documents/0").status_code == 404
    assert admin.get(f"/api/documents/{2**70}").status_code in (404, 422)


def test_only_admins_create(team):
    body = {"title": "Policy", "visibility": "everyone"}
    assert team["user"][0].post("/api/documents", json=body, headers=team["user"][1]).status_code == 403
    for role in ("admin", "superadmin"):
        r = team[role][0].post("/api/documents", json=body, headers=team[role][1])
        assert r.status_code == 201 and r.json()["document"]["title"] == "Policy"


def test_default_visibility_is_admins(team):
    admin, h = team["admin"]
    r = admin.post("/api/documents", json={"title": "Policy"}, headers=h)
    assert r.json()["document"]["visibility"] == "admins"


def test_an_admin_cannot_set_superadmin_only(team):
    admin, h = team["admin"]
    assert admin.post("/api/documents", json={"title": "x", "visibility": "superadmin"}, headers=h).status_code == 403
    root, rh = team["superadmin"]
    assert root.post("/api/documents", json={"title": "x", "visibility": "superadmin"}, headers=rh).status_code == 201


def test_a_pending_document_is_only_the_creators_and_not_listed(team):
    admin, h = team["admin"]
    other = sign_in_more = None
    did = admin.post("/api/documents", json={"title": "wip", "visibility": "everyone"}, headers=h).json()["document"]["id"]
    assert titles(admin) == [] and titles(team["user"][0]) == []
    assert admin.get(f"/api/documents/{did}").status_code == 200  # the creator can see their own pending one
    assert team["superadmin"][0].get(f"/api/documents/{did}").status_code == 404
    assert team["user"][0].get(f"/api/documents/{did}").status_code == 404


def test_old_pending_documents_are_purged_on_the_next_create(team, owner_engine):
    admin, h = team["admin"]
    did = admin.post("/api/documents", json={"title": "old"}, headers=h).json()["document"]["id"]
    with owner_engine.begin() as c:
        c.execute(text("UPDATE documents SET created_at = now() - interval '2 hours' WHERE id = :i"), dict(i=did))
    admin.post("/api/documents", json={"title": "new"}, headers=h)
    assert sql(owner_engine, "SELECT count(*) FROM documents WHERE id = :i", i=did)[0][0] == 0


def test_validation(team):
    admin, h = team["admin"]
    for bad in ({"title": ""}, {"title": "x" * 201}, {"title": "x", "note": "n" * 1001}, {"title": "x", "visibility": "public"}, {"title": "x", "extra": 1}, {"title": "x", "category_id": 99999}):
        assert admin.post("/api/documents", json=bad, headers=h).status_code in (404, 422), bad


def test_patch_changes_fields_and_audits_visibility(team, owner_engine):
    admin, h = team["admin"]
    did = add_visible(owner_engine, "d", "admins")
    r = admin.patch(f"/api/documents/{did}", json={"title": "New", "note": "n", "visibility": "everyone"}, headers=h)
    assert r.status_code == 200 and r.json()["document"]["visibility"] == "everyone"
    actions = [a for (a,) in sql(owner_engine, "SELECT action FROM audit_log ORDER BY id")]
    assert "document_updated" in actions and "document_visibility_changed" in actions


def test_audit_rows_never_carry_titles_or_notes(team, owner_engine):
    admin, h = team["admin"]
    did = admin.post("/api/documents", json={"title": "Secret contract", "note": "very private"}, headers=h).json()["document"]["id"]
    admin.patch(f"/api/documents/{did}", json={"title": "Secret contract 2"}, headers=h)
    admin.delete(f"/api/documents/{did}", headers=h)
    rows = " ".join(str(r) for r in sql(owner_engine, "SELECT action, details::text FROM audit_log"))
    assert "Secret" not in rows and "private" not in rows
    assert "document_added" in rows and "document_deleted" in rows


def test_the_document_limit(team, owner_engine, monkeypatch):
    from app.documents import limits

    monkeypatch.setattr(limits, "MAX_DOCUMENTS", 1)
    admin, h = team["admin"]
    add_visible(owner_engine, "one", "everyone")
    r = admin.post("/api/documents", json={"title": "two"}, headers=h)
    assert r.status_code == 422 and r.json() == {"error": "too_many_documents"}


def test_unauthenticated_is_refused(make_client):
    assert make_client().get("/api/documents").status_code == 401
