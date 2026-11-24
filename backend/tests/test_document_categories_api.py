import pytest
from sqlalchemy import text

from helpers import sql
from test_documents_api import add_visible, sign_in, team  # noqa: F401  (fixture reuse)


def test_everyone_lists_categories_with_the_documents_response(team):
    admin, h = team["admin"]
    admin.post("/api/document-categories", json={"name": "Permits", "icon": "📜"}, headers=h)
    for role in ("user", "admin", "superadmin"):
        names = [c["name"] for c in team[role][0].get("/api/documents").json()["categories"]]
        assert "Permits" in names


def test_only_admins_manage_categories(team):
    for role, status in (("user", 403), ("admin", 201), ("superadmin", 201)):
        c, h = team[role]
        assert c.post("/api/document-categories", json={"name": f"N-{role}"}, headers=h).status_code == status


def test_a_new_category_without_an_icon_stays_without(team):
    admin, h = team["admin"]
    r = admin.post("/api/document-categories", json={"name": "Plain"}, headers=h)
    assert r.json()["category"]["icon"] is None  # the page shows the default icon


def test_names_are_unique_ignoring_case(team):
    admin, h = team["admin"]
    admin.post("/api/document-categories", json={"name": "Permits"}, headers=h)
    r = admin.post("/api/document-categories", json={"name": "permits"}, headers=h)
    assert r.status_code == 409 and r.json() == {"error": "category_exists"}


def test_rename_and_delete_keep_the_documents(team, owner_engine):
    admin, h = team["admin"]
    cid = admin.post("/api/document-categories", json={"name": "Permits"}, headers=h).json()["category"]["id"]
    did = add_visible(owner_engine, "d", "everyone")
    admin.patch(f"/api/documents/{did}", json={"category_id": cid}, headers=h)
    assert admin.patch(f"/api/document-categories/{cid}", json={"name": "Licences", "icon": "📜"}, headers=h).status_code == 200
    assert admin.delete(f"/api/document-categories/{cid}", headers=h).status_code == 204
    assert admin.get(f"/api/documents/{did}").json()["document"]["category_id"] is None
    assert admin.delete(f"/api/document-categories/{cid}", headers=h).status_code == 404


def test_category_audit_rows_have_no_names(team, owner_engine):
    admin, h = team["admin"]
    cid = admin.post("/api/document-categories", json={"name": "Hidden name"}, headers=h).json()["category"]["id"]
    admin.delete(f"/api/document-categories/{cid}", headers=h)
    rows = " ".join(str(r) for r in sql(owner_engine, "SELECT action, details::text FROM audit_log"))
    assert "Hidden name" not in rows and "document_category_created" in rows and "document_category_deleted" in rows
