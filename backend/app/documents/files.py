"""What a document file may be, decided by its contents (never by the name or the declared type).

Only text has no signature: it is accepted by extension *and* a check that it really is UTF-8 text without binary bytes.
Not accepted: archives, programs, scripts, HTML, SVG (anything that can carry active content or turns the library into a
file dump). Office files must be real packages with the right inner files, so a plain zip renamed `.docx` is refused.
"""

import io
import zipfile

OOXML = {
    "word/": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xl/": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "ppt/": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}
ODF = {
    b"application/vnd.oasis.opendocument.text": "application/vnd.oasis.opendocument.text",
    b"application/vnd.oasis.opendocument.spreadsheet": "application/vnd.oasis.opendocument.spreadsheet",
    b"application/vnd.oasis.opendocument.presentation": "application/vnd.oasis.opendocument.presentation",
}
OLE_BY_EXTENSION = {"doc": "application/msword", "xls": "application/vnd.ms-excel", "ppt": "application/vnd.ms-powerpoint"}
TEXT_BY_EXTENSION = {
    "txt": "text/plain", "log": "text/plain", "md": "text/markdown", "markdown": "text/markdown",
    "csv": "text/csv", "tsv": "text/tab-separated-values", "json": "application/json",
}
TEXT_TYPES = frozenset(TEXT_BY_EXTENSION.values())

# Opened in the browser; everything else (Office, RTF, HEIC, TIFF) is always a download.
INLINE_TYPES = frozenset(
    {"application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/bmp"} | TEXT_TYPES
)

BMP_HEADER_SIZES = {12, 40, 52, 56, 64, 108, 124}
AVIF_BRANDS = {b"avif", b"avis"}
HEIC_BRANDS = {b"heic", b"heix", b"hevc", b"hevx", b"heim", b"heis", b"mif1", b"msf1"}


def served_type(content_type: str) -> str:
    """The type sent to the browser: text of any kind is plain text, so it can never be taken for a web page."""
    return "text/plain; charset=utf-8" if content_type in TEXT_TYPES else content_type


def _extension(file_name: str) -> str:
    return file_name.rsplit(".", 1)[-1].lower() if "." in file_name else ""


def _package_type(data: bytes) -> str | None:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as package:
            names = package.namelist()
            if "[Content_Types].xml" in names:
                for prefix, kind in OOXML.items():
                    if any(n.startswith(prefix) for n in names):
                        return kind
                return None
            if "mimetype" in names:
                with package.open("mimetype") as entry:
                    return ODF.get(entry.read(100).strip())
    except (zipfile.BadZipFile, ValueError, OSError, NotImplementedError, RuntimeError):
        return None
    return None


def _text_type(data: bytes, file_name: str) -> str | None:
    kind = TEXT_BY_EXTENSION.get(_extension(file_name))
    if kind is None or b"\x00" in data:
        return None
    try:
        data.decode("utf-8-sig")
    except UnicodeDecodeError:
        return None
    return kind


def detect_document(data: bytes, file_name: str) -> str | None:
    """The true content type of an accepted file, or None."""
    if not data:
        return None
    if data[:5] == b"%PDF-":
        return "application/pdf"
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if data[:2] == b"BM" and int.from_bytes(data[14:18], "little") in BMP_HEADER_SIZES:
        return "image/bmp"
    if data[4:8] == b"ftyp":
        brand = data[8:12]
        return "image/avif" if brand in AVIF_BRANDS else "image/heic" if brand in HEIC_BRANDS else None
    if data[:4] in (b"II*\x00", b"MM\x00*"):
        return "image/tiff"
    if data[:5] == b"{\\rtf":
        return "application/rtf"
    if data[:4] == b"PK\x03\x04":
        return _package_type(data)
    if data[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":
        return OLE_BY_EXTENSION.get(_extension(file_name))
    return _text_type(data, file_name)
