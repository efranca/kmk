"""TOTP primitives (no database access): secrets, codes, encryption, recovery codes."""

import hashlib
import secrets
import time

import pyotp
from cryptography.fernet import Fernet, InvalidToken

STEP_SECONDS = 30
RECOVERY_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz"  # no 0/1/i/l/o: unambiguous when typed from paper


def now() -> float:
    """Wrapped so tests can move the clock."""
    return time.time()


def new_secret() -> str:
    return pyotp.random_base32()


def provisioning_uri(secret: str, username: str, issuer: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=username, issuer_name=issuer)


def encrypt_secret(secret: str, key: str) -> str:
    return Fernet(key.encode()).encrypt(secret.encode()).decode()


def decrypt_secret(token: str, key: str) -> str:
    try:
        return Fernet(key.encode()).decrypt(token.encode()).decode()
    except (InvalidToken, ValueError) as exc:
        raise ValueError("cannot decrypt the TOTP secret (wrong or missing key)") from exc


def matching_step(secret: str, code: str, last_step: int | None) -> int | None:
    """The time step `code` belongs to (previous, current or next step), if it is newer than `last_step`."""
    code = code.replace(" ", "")
    if len(code) != 6 or not code.isdigit():
        return None
    totp = pyotp.TOTP(secret, interval=STEP_SECONDS)
    current = int(now()) // STEP_SECONDS
    for step in (current - 1, current, current + 1):
        if secrets.compare_digest(totp.at(step * STEP_SECONDS), code) and step > (last_step if last_step is not None else -1):
            return step
    return None


def new_recovery_codes(count: int = 10) -> list[str]:
    codes: set[str] = set()
    while len(codes) < count:
        raw = "".join(secrets.choice(RECOVERY_ALPHABET) for _ in range(10))
        codes.add(f"{raw[:5]}-{raw[5:]}")
    return list(codes)


def normalize_recovery_code(code: str) -> str:
    return "".join(ch for ch in code.lower() if ch.isalnum())


def hash_recovery_code(code: str) -> str:
    return hashlib.sha256(normalize_recovery_code(code).encode()).hexdigest()
