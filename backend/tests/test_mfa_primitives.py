import re

import pyotp
import pytest

from app import mfa
from app.config import Settings

NOW = 1_700_000_000.0  # a fixed clock: step 56_666_666


def step_now() -> int:
    return int(NOW) // 30


def code_for(secret: str, step: int) -> str:
    return pyotp.TOTP(secret).at(step * 30)


@pytest.fixture(autouse=True)
def fixed_clock(monkeypatch):
    monkeypatch.setattr(mfa, "now", lambda: NOW)


def test_encrypt_decrypt_roundtrip(mfa_key):
    secret = mfa.new_secret()
    token = mfa.encrypt_secret(secret, mfa_key)
    assert secret not in token
    assert mfa.decrypt_secret(token, mfa_key) == secret


def test_wrong_key_raises_value_error(mfa_key):
    from cryptography.fernet import Fernet

    token = mfa.encrypt_secret(mfa.new_secret(), mfa_key)
    with pytest.raises(ValueError):
        mfa.decrypt_secret(token, Fernet.generate_key().decode())


def test_provisioning_uri():
    secret = mfa.new_secret()
    uri = mfa.provisioning_uri(secret, "alice", "KMK Entretien")
    assert uri.startswith("otpauth://totp/")
    assert "alice" in uri and f"secret={secret}" in uri and "issuer=KMK" in uri


def test_secret_is_base32():
    assert re.fullmatch(r"[A-Z2-7]{16,}", mfa.new_secret())


@pytest.mark.parametrize("offset", [-1, 0, 1])
def test_window_accepts_adjacent_steps(offset):
    secret = mfa.new_secret()
    assert mfa.matching_step(secret, code_for(secret, step_now() + offset), None) == step_now() + offset


@pytest.mark.parametrize("offset", [-2, 2])
def test_window_rejects_distant_steps(offset):
    secret = mfa.new_secret()
    assert mfa.matching_step(secret, code_for(secret, step_now() + offset), None) is None


def test_step_must_be_newer_than_last_step():
    secret = mfa.new_secret()
    code = code_for(secret, step_now())
    assert mfa.matching_step(secret, code, step_now() - 1) == step_now()
    assert mfa.matching_step(secret, code, step_now()) is None
    assert mfa.matching_step(secret, code, step_now() + 5) is None


@pytest.mark.parametrize("bad", ["", "12345", "1234567", "abcdef", "12 34"])
def test_malformed_codes_rejected(bad):
    assert mfa.matching_step(mfa.new_secret(), bad, None) is None


def test_spaces_in_a_code_are_ignored():
    secret = mfa.new_secret()
    code = code_for(secret, step_now())
    assert mfa.matching_step(secret, f"{code[:3]} {code[3:]}", None) == step_now()


def test_recovery_codes_shape():
    codes = mfa.new_recovery_codes()
    assert len(codes) == 10 and len(set(codes)) == 10
    for c in codes:
        assert re.fullmatch(r"[2-9a-hj-km-np-z]{5}-[2-9a-hj-km-np-z]{5}", c)


def test_recovery_code_normalization_and_hash():
    assert mfa.normalize_recovery_code("ABCDE-fgh23") == "abcdefgh23"
    assert mfa.normalize_recovery_code(" abcde fgh23 ") == "abcdefgh23"
    h = mfa.hash_recovery_code("abcde-fgh23")
    assert re.fullmatch(r"[0-9a-f]{64}", h)
    assert h == mfa.hash_recovery_code("ABCDEFGH23") == mfa.hash_recovery_code("abcde fgh23")


def test_required_roles_parsing():
    assert Settings(database_url="x", mfa_required_roles="").required_roles == set()
    assert Settings(database_url="x", mfa_required_roles="admin, superadmin").required_roles == {"admin", "superadmin"}
