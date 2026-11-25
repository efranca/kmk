"""The numbers of the public quote form (see docs/superpowers/specs/2026-11-25-quotes-design.md)."""

from datetime import timedelta

MAX_PER_IP_PER_HOUR = 10
DRAFT_TTL = timedelta(hours=2)
MAX_PHOTOS = 10
MAX_PHOTO_BYTES = 8 * 1024 * 1024
MAX_PENDING_PHOTO_BYTES = 300 * 1024 * 1024  # photos of drafts nobody has sent yet
MAX_WORDS = 2000
MAX_CHARS = 20_000
PHOTO_TYPES = frozenset({"image/jpeg", "image/png", "image/webp", "image/heic"})
DEADLINE = timedelta(hours=24)
