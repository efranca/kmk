import pytest

from app.documents.files import detect_document
from app.documents.visibility import can_view, visible_levels


def test_each_role_sees_its_levels_and_below():
    assert visible_levels("user") == {"everyone"}
    assert visible_levels("admin") == {"everyone", "admins"}
    assert visible_levels("superadmin") == {"everyone", "admins", "superadmin"}


def test_an_unknown_role_sees_nothing():
    assert visible_levels("guest") == frozenset()


@pytest.mark.parametrize(
    "role, level, expected",
    [("user", "everyone", True), ("user", "admins", False), ("user", "superadmin", False),
     ("admin", "admins", True), ("admin", "superadmin", False), ("superadmin", "superadmin", True)],
)
def test_can_view(role, level, expected):
    assert can_view(role, level) is expected


PDF = b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj"
JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF"
PNG = b"\x89PNG\r\n\x1a\n\x00\x00"
WEBP = b"RIFF\x24\x00\x00\x00WEBPVP8 "


@pytest.mark.parametrize("data, kind", [(PDF, "application/pdf"), (JPEG, "image/jpeg"), (PNG, "image/png"), (WEBP, "image/webp")])
def test_known_types_by_their_first_bytes(data, kind):
    assert detect_document(data, 'file') == kind


@pytest.mark.parametrize("data", [b"", b"hello", b"<html>%PDF-</html>", b" %PDF-1.4", b"PK\x03\x04zip", b"MZ\x90\x00exe"])
def test_everything_else_is_refused(data):
    assert detect_document(data, 'file') is None
