"""Where a request came from, as far as Cloudflare says (informational only, never used for a decision).

Caddy copies Cloudflare's `Cf-Ipcountry` / `Cf-Ipcity` into `X-Geo-Country` / `X-Geo-City` (overwriting what the client
sent). They are believed only from a trusted proxy peer, like the forwarded client address, and are sanitized because
they end up on the super admin's screen.
"""

import re
import unicodedata

from fastapi import Request

from app.config import Settings

_COUNTRY = re.compile(r"[A-Z]{2}")


def sanitize_country(raw: str | None) -> str | None:
    value = (raw or "").strip().upper()
    return value if _COUNTRY.fullmatch(value) else None


def _utf8_from_latin1(raw: str) -> str:
    """HTTP header values arrive decoded as latin-1; a city sent as UTF-8 bytes comes out as mojibake ("MontrÃ©al")."""
    try:
        return raw.encode("latin-1").decode("utf-8")
    except UnicodeError:
        return raw


def sanitize_city(raw: str | None) -> str | None:
    cleaned = "".join(ch for ch in _utf8_from_latin1(raw or "") if unicodedata.category(ch)[0] != "C").strip()
    return cleaned[:100] or None


def from_request(request: Request, settings: Settings) -> tuple[str | None, str | None]:
    peer = request.client.host if request.client else ""
    if peer not in settings.trusted_proxy_ips:
        return None, None
    return sanitize_country(request.headers.get("x-geo-country")), sanitize_city(request.headers.get("x-geo-city"))
