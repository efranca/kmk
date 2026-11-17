import hashlib
import hmac
import ipaddress
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

_hasher = PasswordHasher()  # Argon2id with the library's RFC 9106 low-memory defaults


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)


# Verified against when the account doesn't exist, so unknown users cost the same time as wrong passwords.
DUMMY_HASH = hash_password(secrets.token_urlsafe(16))


def validate_password_rules(password: str) -> list[str]:
    problems = []
    if len(password) < 8:
        problems.append("too_short")
    if not any(c.isalpha() for c in password):
        problems.append("no_letter")
    if not any(c.isdigit() for c in password):
        problems.append("no_digit")
    if not any(not c.isalnum() for c in password):
        problems.append("no_special")
    return problems


def new_session_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def csrf_token(session_token_hash: str, secret: str) -> str:
    return hmac.new(secret.encode(), session_token_hash.encode(), hashlib.sha256).hexdigest()


def verify_csrf(session_token_hash: str, secret: str, presented: str) -> bool:
    return hmac.compare_digest(csrf_token(session_token_hash, secret), presented or "")


def client_ip(peer: str, forwarded: str | None, trusted: list[str]) -> str:
    """The forwarded address is believed only when the TCP peer is a trusted proxy."""
    if peer in trusted and forwarded:
        try:
            return str(ipaddress.ip_address(forwarded.strip()))
        except ValueError:
            pass
    return peer
