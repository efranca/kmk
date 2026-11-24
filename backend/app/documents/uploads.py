"""Receiving a file safely: a size cap while reading, a limit on uploads at once, and a clean file name."""

import unicodedata
from urllib.parse import unquote

from fastapi import Request

from app.auth.errors import ApiError
from app.documents import limits


class Slots:
    """At most N uploads in flight (each holds up to a few copies of the file in memory). Single event loop: no lock needed."""

    def __init__(self) -> None:
        self.active = 0

    def acquire(self) -> None:
        if self.active >= limits.MAX_CONCURRENT_UPLOADS:
            raise ApiError(503, "busy")
        self.active += 1

    def release(self) -> None:
        self.active = max(0, self.active - 1)


slots = Slots()


async def read_capped(request: Request, limit: int | None = None, error: str = "file_too_large") -> bytes:
    """The request body, refused as soon as it is (or is declared) over the limit (the file limit unless given)."""
    limit = limits.MAX_FILE_BYTES if limit is None else limit
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > limit:
        raise ApiError(422, error)
    buffer = bytearray()
    async for chunk in request.stream():
        buffer += chunk
        if len(buffer) > limit:
            raise ApiError(422, error)
    return bytes(buffer)


def clean_file_name(raw: str | None) -> str:
    """The name the browser sent (percent-encoded UTF-8): no folders, no control characters, at most 200 characters."""
    name = unquote(raw or "", errors="replace")
    name = name.replace("\\", "/").rsplit("/", 1)[-1]
    name = "".join(c for c in name if unicodedata.category(c)[0] != "C").strip().strip(".")
    return name[:200] or "document"
