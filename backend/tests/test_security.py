from app.security import (
    DUMMY_HASH,
    client_ip,
    csrf_token,
    hash_password,
    hash_token,
    needs_rehash,
    new_session_token,
    validate_password_rules,
    verify_csrf,
    verify_password,
)


def test_hash_and_verify():
    h = hash_password("Abcdef1!")
    assert h.startswith("$argon2id$")
    assert verify_password(h, "Abcdef1!") is True
    assert verify_password(h, "wrong") is False
    assert verify_password("garbage", "Abcdef1!") is False
    assert hash_password("Abcdef1!") != h
    assert needs_rehash(h) is False
    assert DUMMY_HASH.startswith("$argon2id$")


def test_password_rules():
    assert validate_password_rules("Abcdef1!") == []
    assert validate_password_rules("short1!") == ["too_short"]
    assert validate_password_rules("abcdefgh") == ["no_digit", "no_special"]
    assert validate_password_rules("12345678!") == ["no_letter"]


def test_tokens():
    a, b = new_session_token(), new_session_token()
    assert a != b
    h = hash_token(a)
    assert len(h) == 64 and h == hash_token(a) and h != hash_token(b)


def test_csrf():
    t = csrf_token("hash1", "secret")
    assert verify_csrf("hash1", "secret", t) is True
    assert verify_csrf("hash2", "secret", t) is False
    assert verify_csrf("hash1", "other", t) is False
    assert verify_csrf("hash1", "secret", "") is False


def test_client_ip():
    trusted = ["127.0.0.1", "::1"]
    assert client_ip("127.0.0.1", "203.0.113.9", trusted) == "203.0.113.9"
    assert client_ip("198.51.100.7", "203.0.113.9", trusted) == "198.51.100.7"
    assert client_ip("127.0.0.1", "not-an-ip", trusted) == "127.0.0.1"
    assert client_ip("127.0.0.1", None, trusted) == "127.0.0.1"
    assert client_ip("127.0.0.1", " 2001:db8::1 ", trusted) == "2001:db8::1"
