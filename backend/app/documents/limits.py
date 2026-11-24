"""Product limits for the document library (constants: raising one needs no migration)."""

from datetime import timedelta

MAX_FILE_BYTES = 50 * 1024 * 1024
MAX_DOCUMENTS = 500
MAX_LIBRARY_BYTES = 2 * 1024**3
PENDING_TTL = timedelta(hours=1)
MAX_CONCURRENT_UPLOADS = 2
MAX_PREVIEW_BYTES = 100 * 1024  # the tiles view's small JPEG
