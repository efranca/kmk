import io
import zipfile

import pytest

from app.documents.files import INLINE_TYPES, detect_document, served_type

PDF = b"%PDF-1.7\n1 0 obj"
JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF" + b"0" * 20
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 20
WEBP = b"RIFF\x24\x00\x00\x00WEBPVP8 "
GIF = b"GIF89a" + b"0" * 20
BMP = b"BM" + b"\x00" * 12 + (40).to_bytes(4, "little") + b"\x00" * 20
TIFF_LE = b"II*\x00" + b"0" * 20
TIFF_BE = b"MM\x00*" + b"0" * 20


def bmff(brand: bytes) -> bytes:
    return b"\x00\x00\x00\x18ftyp" + brand + b"\x00\x00\x00\x00" + brand + b"0" * 8


def package(entries: dict[str, bytes]) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        for name, content in entries.items():
            z.writestr(name, content)
    return out.getvalue()


DOCX = package({"[Content_Types].xml": b"<Types/>", "word/document.xml": b"<w/>"})
XLSX = package({"[Content_Types].xml": b"<Types/>", "xl/workbook.xml": b"<w/>"})
PPTX = package({"[Content_Types].xml": b"<Types/>", "ppt/presentation.xml": b"<w/>"})


def odf(kind: str) -> bytes:
    return package({"mimetype": f"application/vnd.oasis.opendocument.{kind}".encode(), "content.xml": b"<c/>"})


OLE = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"0" * 40


@pytest.mark.parametrize(
    "data, name, expected",
    [
        (PDF, "a.pdf", "application/pdf"),
        (JPEG, "a.jpg", "image/jpeg"), (PNG, "a.png", "image/png"), (WEBP, "a.webp", "image/webp"),
        (GIF, "a.gif", "image/gif"), (BMP, "a.bmp", "image/bmp"),
        (bmff(b"avif"), "a.avif", "image/avif"), (bmff(b"heic"), "a.heic", "image/heic"), (bmff(b"mif1"), "a.heif", "image/heic"),
        (TIFF_LE, "a.tif", "image/tiff"), (TIFF_BE, "a.tiff", "image/tiff"),
        (b"{\\rtf1\\ansi hello}", "a.rtf", "application/rtf"),
        (DOCX, "a.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
        (XLSX, "a.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        (PPTX, "a.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
        (odf("text"), "a.odt", "application/vnd.oasis.opendocument.text"),
        (odf("spreadsheet"), "a.ods", "application/vnd.oasis.opendocument.spreadsheet"),
        (odf("presentation"), "a.odp", "application/vnd.oasis.opendocument.presentation"),
        (OLE, "a.doc", "application/msword"), (OLE, "a.xls", "application/vnd.ms-excel"), (OLE, "a.ppt", "application/vnd.ms-powerpoint"),
        ("Héllo\nworld".encode(), "notes.txt", "text/plain"), (b"# Title\n", "README.md", "text/markdown"),
        (b"a,b\n1,2\n", "t.csv", "text/csv"), (b"a\tb\n", "t.tsv", "text/tab-separated-values"),
        (b'{"a": 1}', "d.json", "application/json"), (b"line\n", "x.log", "text/plain"),
        (b"\xef\xbb\xbfwith bom", "bom.txt", "text/plain"),
    ],
)
def test_accepted_from_the_contents(data, name, expected):
    assert detect_document(data, name) == expected


@pytest.mark.parametrize(
    "data, name",
    [
        (b"", "a.pdf"), (b"hello", "a.pdf"), (b" %PDF-1.4", "a.pdf"), (b"<html>%PDF-</html>", "a.pdf"),
        (b"<html><script>1</script></html>", "a.html"),
        (b"<svg xmlns='http://www.w3.org/2000/svg'/>", "a.svg"), (b"<?xml version='1.0'?><svg/>", "a.svg"),
        (b"MZ\x90\x00exe", "a.exe"), (b"#!/bin/sh\nrm -rf /", "a.sh"), (b"PK\x03\x04junk", "a.zip"),
        (package({"a.txt": b"x"}), "a.zip"), (package({"a.txt": b"x"}), "a.docx"),  # a zip is not an Office file
        (package({"[Content_Types].xml": b"<T/>", "other/x.xml": b"<x/>"}), "a.docx"),
        (package({"mimetype": b"text/plain", "content.xml": b"<c/>"}), "a.odt"),  # wrong ODF mimetype
        (package({"mimetype": b"application/epub+zip"}), "a.epub"),
        (b"binary\x00text", "a.txt"), (b"binary\x00text", "a.md"), (b"\xff\xfe\x00bad utf8 \x80", "a.txt"),
        (b"plain text", "a.exe"), (b"plain text", "noextension"), (b"plain text", "a.docx"),
        (OLE, "a.exe"), (OLE, "a.txt"),
        (b"GIF89", "a.gif"), (b"BM", "a.bmp"),
    ],
)
def test_refused(data, name):
    assert detect_document(data, name) is None


def test_a_corrupt_zip_is_refused_not_a_crash():
    assert detect_document(b"PK\x03\x04" + b"\x00" * 30, "a.docx") is None


def test_extension_case_is_ignored_for_text():
    assert detect_document(b"hello", "NOTES.TXT") == "text/plain"


def test_inline_types_are_the_ones_a_browser_can_show_safely():
    assert {"application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif", "image/avif", "image/bmp", "text/plain", "text/markdown", "text/csv", "application/json"} <= INLINE_TYPES
    for kind in ("image/heic", "image/tiff", "application/rtf", "application/msword", "text/html", "image/svg+xml"):
        assert kind not in INLINE_TYPES


def test_text_is_served_as_plain_text():
    assert served_type("text/markdown") == "text/plain; charset=utf-8"
    assert served_type("application/json") == "text/plain; charset=utf-8"
    assert served_type("application/pdf") == "application/pdf"
