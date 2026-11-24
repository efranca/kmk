import pytest

from helpers import sql
from test_documents_api import add_visible, team  # noqa: F401  (fixture reuse)
from test_documents_files import PDF, new_document, put

JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF" + b"j" * 300


def put_preview(client, headers, did, data=JPEG):
    return client.put(f"/api/documents/{did}/preview", content=data, headers={**headers, "Content-Type": "image/jpeg"})


def with_file(team):
    admin, h = team["admin"]
    did = new_document(admin, h)
    assert put(admin, h, did, PDF).status_code == 204
    return admin, h, did


def test_a_preview_is_stored_and_flagged(team):
    admin, h, did = with_file(team)
    assert admin.get(f"/api/documents/{did}").json()["document"]["has_preview"] is False
    assert put_preview(admin, h, did).status_code == 204
    assert admin.get(f"/api/documents/{did}").json()["document"]["has_preview"] is True
    listed = {d["id"]: d for d in team["user"][0].get("/api/documents").json()["documents"]}
    assert listed[did]["has_preview"] is True


def test_the_preview_is_served_like_an_image_with_an_etag(team):
    admin, h, did = with_file(team)
    put_preview(admin, h, did)
    r = team["user"][0].get(f"/api/documents/{did}/preview")
    assert r.status_code == 200 and r.content == JPEG
    assert r.headers["content-type"] == "image/jpeg"
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["content-security-policy"].startswith("sandbox")
    assert r.headers["cache-control"] == "private, max-age=0, must-revalidate"
    again = team["user"][0].get(f"/api/documents/{did}/preview", headers={"If-None-Match": r.headers["etag"]})
    assert again.status_code == 304


@pytest.mark.parametrize("data", [b"", b"GIF89a" + b"0" * 40, b"\x89PNG\r\n\x1a\n" + b"0" * 40, b"<html></html>", b"%PDF-1.4 x"])
def test_only_a_jpeg_is_accepted(team, owner_engine, data):
    admin, h, did = with_file(team)
    r = put_preview(admin, h, did, data)
    assert r.status_code == 422 and r.json() == {"error": "invalid_file"}
    assert sql(owner_engine, "SELECT count(*) FROM document_previews")[0][0] == 0


def test_the_size_cap(team, monkeypatch, owner_engine):
    from app.documents import limits

    monkeypatch.setattr(limits, "MAX_PREVIEW_BYTES", 500)
    admin, h, did = with_file(team)
    assert put_preview(admin, h, did, JPEG[:10] + b"j" * 600).status_code == 422  # declared length
    assert admin.put(f"/api/documents/{did}/preview", content=(c for c in [JPEG[:12], b"j" * 300, b"j" * 300]), headers=h).status_code == 422  # streamed
    assert sql(owner_engine, "SELECT count(*) FROM document_previews")[0][0] == 0
    assert put_preview(admin, h, did, JPEG[:12] + b"j" * 100).status_code == 204


def test_replacing_a_preview_keeps_one(team, owner_engine):
    admin, h, did = with_file(team)
    put_preview(admin, h, did)
    put_preview(admin, h, did, JPEG + b"more")
    assert sql(owner_engine, "SELECT count(*) FROM document_previews")[0][0] == 1
    assert admin.get(f"/api/documents/{did}/preview").content == JPEG + b"more"


def test_replacing_the_file_drops_the_old_preview(team):
    admin, h, did = with_file(team)
    put_preview(admin, h, did)
    assert put(admin, h, did, PDF + b"2").status_code == 204
    assert admin.get(f"/api/documents/{did}/preview").status_code == 404
    assert admin.get(f"/api/documents/{did}").json()["document"]["has_preview"] is False


def test_deleting_the_document_deletes_the_preview(team, owner_engine):
    admin, h, did = with_file(team)
    put_preview(admin, h, did)
    admin.delete(f"/api/documents/{did}", headers=h)
    assert sql(owner_engine, "SELECT count(*) FROM document_previews")[0][0] == 0


def test_only_admins_upload_a_preview(team):
    admin, h, did = with_file(team)
    assert put_preview(*team["user"], did).status_code == 403


def test_a_hidden_document_has_no_preview_for_you(team, owner_engine):
    hidden = add_visible(owner_engine, "root only", "superadmin")
    root, rh = team["superadmin"]
    assert put_preview(root, rh, hidden).status_code == 204
    assert team["user"][0].get(f"/api/documents/{hidden}/preview").status_code == 404
    assert team["admin"][0].get(f"/api/documents/{hidden}/preview").status_code == 404
    assert put_preview(*team["admin"], hidden).status_code == 404
    assert root.get(f"/api/documents/{hidden}/preview").status_code == 200
    listed = {d["id"] for d in team["admin"][0].get("/api/documents").json()["documents"]}
    assert hidden not in listed


def test_a_document_without_a_file_takes_no_preview(team):
    admin, h = team["admin"]
    did = new_document(admin, h)  # pending: no file yet
    assert put_preview(admin, h, did).status_code == 404
    assert admin.get(f"/api/documents/{did}/preview").status_code == 404
    assert admin.get("/api/documents/999999/preview").status_code == 404
