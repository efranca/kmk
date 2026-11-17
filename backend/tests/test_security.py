from pathlib import Path

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


# ---- review F5: Argon2 uses 64 MiB per call; never run more than a few at once ----

def test_argon2_work_is_capped_in_parallel(monkeypatch):
    import threading
    import time

    from app import security

    state = {"now": 0, "max": 0}
    lock = threading.Lock()

    def slow_verify(*args, **kwargs):
        with lock:
            state["now"] += 1
            state["max"] = max(state["max"], state["now"])
        time.sleep(0.05)
        with lock:
            state["now"] -= 1
        return True

    class SlowHasher:
        verify = staticmethod(slow_verify)

    monkeypatch.setattr(security, "_hasher", SlowHasher())
    threads = [threading.Thread(target=security.verify_password, args=("hash", "pw")) for _ in range(16)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert 1 <= state["max"] <= 4  # at most 4 x 64 MiB at any moment, however many requests arrive


def test_the_proxy_limits_request_bodies_for_the_api():
    caddyfile = (Path(__file__).resolve().parents[2] / "deploy" / "caddy" / "Caddyfile").read_text()
    api_block = caddyfile[caddyfile.index("handle /api/*"):caddyfile.index("# Missing assets")]
    assert "request_body" in api_block and "max_size 64KB" in api_block
