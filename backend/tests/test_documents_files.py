import pytest
from sqlalchemy import text

from helpers import sql
from test_documents_api import add_visible, sign_in, team  # noqa: F401  (fixture reuse)

PDF = b"%PDF-1.7\n" + b"x" * 200
PNG = b"\x89PNG\r\n\x1a\n" + b"y" * 100


def new_document(client, headers, **body):
    return client.post("/api/documents", json={"title": "Policy", "visibility": "everyone", **body}, headers=headers).json()["document"]["id"]


def put(client, headers, did, data, name="Policy.pdf", **extra):
    return client.put(f"/api/documents/{did}/file", content=data, headers={**headers, "X-File-Name": name, "Content-Type": "application/octet-stream", **extra})


def test_upload_makes_the_document_visible_with_its_file_facts(team):
    admin, h = team["admin"]
    did = new_document(admin, h)
    assert put(admin, h, did, PDF).status_code == 204
    doc = team["user"][0].get(f"/api/documents/{did}").json()["document"]
    assert doc["has_file"] and doc["file_name"] == "Policy.pdf" and doc["content_type"] == "application/pdf" and doc["size_bytes"] == len(PDF)


def test_png_is_accepted_and_the_type_comes_from_the_bytes(team):
    admin, h = team["admin"]
    did = new_document(admin, h)
    assert put(admin, h, did, PNG, name="scan.pdf", **{"Content-Type": "application/pdf"}).status_code == 204
    assert admin.get(f"/api/documents/{did}").json()["document"]["content_type"] == "image/png"


@pytest.mark.parametrize("data", [b"", b"just text", b"<html>%PDF-</html>", b"PK\x03\x04zip", b"MZ\x90exe"])
def test_wrong_bytes_are_refused_and_nothing_is_stored(team, owner_engine, data):
    admin, h = team["admin"]
    did = new_document(admin, h)
    r = put(admin, h, did, data, name="Policy.pdf")
    assert r.status_code == 422 and r.json() == {"error": "invalid_file"}
    assert sql(owner_engine, "SELECT count(*) FROM document_files")[0][0] == 0
    assert admin.get(f"/api/documents/{did}").json()["document"]["has_file"] is False


def test_too_large_by_declared_length_and_by_streamed_total(team, monkeypatch, owner_engine):
    from app.documents import limits

    monkeypatch.setattr(limits, "MAX_FILE_BYTES", 1000)
    admin, h = team["admin"]
    did = new_document(admin, h)
    big = b"%PDF-" + b"z" * 1500
    r = put(admin, h, did, big)
    assert r.status_code == 422 and r.json() == {"error": "file_too_large"}
    # a body streamed without a declared length is capped while it is read
    r = admin.put(f"/api/documents/{did}/file", content=(chunk for chunk in [b"%PDF-" + b"z" * 600, b"z" * 600]), headers={**h, "X-File-Name": "a.pdf"})
    assert r.status_code == 422 and r.json() == {"error": "file_too_large"}
    assert sql(owner_engine, "SELECT count(*) FROM document_files")[0][0] == 0
    assert put(admin, h, did, b"%PDF-" + b"z" * 900).status_code == 204  # exactly under the limit is fine


def test_the_library_limit_names_itself(team, monkeypatch, owner_engine):
    from app.documents import limits

    admin, h = team["admin"]
    add_visible(owner_engine, "existing", "everyone")  # 5 bytes
    monkeypatch.setattr(limits, "MAX_LIBRARY_BYTES", 100)
    did = new_document(admin, h)
    r = put(admin, h, did, b"%PDF-" + b"z" * 100)
    assert r.status_code == 422 and r.json() == {"error": "library_full"}
    assert put(admin, h, did, b"%PDF-" + b"z" * 50).status_code == 204


def test_replacing_swaps_the_bytes_and_keeps_the_document(team, owner_engine):
    admin, h = team["admin"]
    did = new_document(admin, h)
    put(admin, h, did, PDF)
    assert put(admin, h, did, PNG, name="other.png").status_code == 204
    doc = admin.get(f"/api/documents/{did}").json()["document"]
    assert doc["id"] == did and doc["content_type"] == "image/png" and doc["file_name"] == "other.png"
    assert sql(owner_engine, "SELECT count(*) FROM document_files")[0][0] == 1
    assert admin.get(f"/api/documents/{did}/file").content == PNG
    assert "document_replaced" in [a for (a,) in sql(owner_engine, "SELECT action FROM audit_log")]


def test_replacing_counts_the_old_size_once_against_the_library(team, monkeypatch):
    from app.documents import limits

    admin, h = team["admin"]
    did = new_document(admin, h)
    put(admin, h, did, b"%PDF-" + b"z" * 80)
    monkeypatch.setattr(limits, "MAX_LIBRARY_BYTES", 100)
    assert put(admin, h, did, b"%PDF-" + b"z" * 90).status_code == 204  # the old 85 bytes are replaced, not added


def test_only_admins_upload_and_only_to_what_they_can_see(team, owner_engine):
    admin, h = team["admin"]
    did = new_document(admin, h)
    assert put(*team["user"], did, PDF).status_code == 403
    hidden = add_visible(owner_engine, "root only", "superadmin")
    assert put(admin, h, hidden, PDF).status_code == 404
    assert put(admin, h, 999999, PDF).status_code == 404


def test_download_headers(team):
    admin, h = team["admin"]
    did = new_document(admin, h)
    put(admin, h, did, PDF, name="Policy.pdf")
    r = team["user"][0].get(f"/api/documents/{did}/file")
    assert r.status_code == 200 and r.content == PDF
    assert r.headers["content-type"] == "application/pdf"
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["content-security-policy"] == "sandbox"
    assert r.headers["cache-control"] == "private, no-store"
    assert r.headers["content-disposition"].startswith("inline;")
    d = team["user"][0].get(f"/api/documents/{did}/file?download=1")
    assert d.headers["content-disposition"].startswith("attachment;")


def test_the_file_name_is_escaped_in_the_header(team):
    admin, h = team["admin"]
    did = new_document(admin, h)
    nasty = 'a"b\r\nSet-Cookie: x=1;é/..\\name.pdf'
    from urllib.parse import quote

    put(admin, h, did, PDF, name=quote(nasty))
    r = admin.get(f"/api/documents/{did}/file")
    disposition = r.headers["content-disposition"]
    assert "\n" not in disposition and "\r" not in disposition and "Set-Cookie" not in r.headers
    stored = admin.get(f"/api/documents/{did}").json()["document"]["file_name"]
    assert "/" not in stored and "\\" not in stored and "\n" not in stored and stored.endswith("name.pdf")


def test_a_document_you_may_not_see_has_no_file_for_you(team, owner_engine):
    hidden = add_visible(owner_engine, "root only", "superadmin")
    assert team["user"][0].get(f"/api/documents/{hidden}/file").status_code == 404
    assert team["admin"][0].get(f"/api/documents/{hidden}/file").status_code == 404
    assert team["superadmin"][0].get(f"/api/documents/{hidden}/file").status_code == 200


def test_a_pending_document_has_no_file_to_download(team):
    admin, h = team["admin"]
    did = new_document(admin, h)
    assert admin.get(f"/api/documents/{did}/file").status_code == 404


def test_too_many_uploads_at_once_get_busy(team):
    from app.documents import limits, uploads

    admin, h = team["admin"]
    did = new_document(admin, h)
    uploads.slots.active = limits.MAX_CONCURRENT_UPLOADS
    try:
        r = put(admin, h, did, PDF)
        assert r.status_code == 503 and r.json() == {"error": "busy"}
    finally:
        uploads.slots.active = 0
    assert put(admin, h, did, PDF).status_code == 204  # the slot count recovered


def test_a_refused_upload_frees_its_slot(team):
    from app.documents import uploads

    admin, h = team["admin"]
    did = new_document(admin, h)
    for _ in range(5):
        assert put(admin, h, did, b"nope").status_code == 422
    assert uploads.slots.active == 0


def test_deleting_removes_the_bytes(team, owner_engine):
    admin, h = team["admin"]
    did = new_document(admin, h)
    put(admin, h, did, PDF)
    assert admin.delete(f"/api/documents/{did}", headers=h).status_code == 204
    assert sql(owner_engine, "SELECT count(*) FROM document_files")[0][0] == 0


def test_audit_rows_carry_no_file_names(team, owner_engine):
    admin, h = team["admin"]
    did = new_document(admin, h)
    put(admin, h, did, PDF, name="Confidential-payroll.pdf")
    put(admin, h, did, PNG, name="Confidential-2.png")
    rows = " ".join(str(r) for r in sql(owner_engine, "SELECT action, details::text FROM audit_log"))
    assert "Confidential" not in rows
