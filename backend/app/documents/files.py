"""What a document file may be: PDF or an image, decided by the first bytes, never by the name or the declared type."""

from app.auth.avatars import sniff as sniff_image


def sniff_document(data: bytes) -> str | None:
    if data[:5] == b"%PDF-":
        return "application/pdf"
    return sniff_image(data)
