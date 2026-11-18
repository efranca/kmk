"""A person's display name: validation and accent-insensitive comparison."""

import re
import unicodedata

MAX_LENGTH = 100
_PUNCTUATION = {" ", "'", "’", "-", "."}  # space, apostrophes, hyphen, period
_FORBIDDEN_CATEGORIES = {"Cc", "Cf", "Cs", "Co", "Cn"}  # control, format (zero-width, direction overrides), surrogate, private, unassigned


def clean_name(value: str) -> str:
    """Return the tidy form of a name, or raise ValueError.

    NFC-normalized, trimmed, runs of spaces collapsed, 1-100 characters. Only letters, combining marks, digits, spaces,
    apostrophes, hyphens and periods are allowed, so markup, line breaks and invisible or direction-changing
    characters cannot get in.
    """
    if not isinstance(value, str):
        raise ValueError("the name must be text")
    text = unicodedata.normalize("NFC", value)
    if any(unicodedata.category(ch) in _FORBIDDEN_CATEGORIES for ch in text):
        raise ValueError("the name contains a control or invisible character")
    text = re.sub(r"\s+", " ", text).strip()
    if not 1 <= len(text) <= MAX_LENGTH:
        raise ValueError(f"the name must be 1 to {MAX_LENGTH} characters")
    for ch in text:
        if unicodedata.category(ch)[0] in ("L", "M", "N") or ch in _PUNCTUATION:
            continue
        raise ValueError("the name contains a character that is not allowed")
    return text


def fold(text: str) -> str:
    """Accents removed, case folded, spaces collapsed: for sorting and searching ("Élise" == "elise")."""
    decomposed = unicodedata.normalize("NFKD", text)
    stripped = "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")
    return " ".join(stripped.casefold().split())


def sort_key(name: str | None, username: str) -> tuple[str, str]:
    """People without a name sort by their username."""
    return (fold(name or username), username)
