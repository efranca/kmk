import pytest

import app.main  # noqa: F401  (imports the application in its usual order; avoids a pre-existing circular import)
from app import version
from helpers import login


@pytest.mark.parametrize(
    "count, expected",
    [("57", "0.2.57"), (None, "0.2.0"), ("abc", "0.2.0"), ("0", "0.2.0"), ("", "0.2.0"), ("-3", "0.2.0")],
)
def test_compute_version(count, expected):
    assert version.compute_version("0.2.0", count) == expected


def test_build_info_reads_the_baked_environment(monkeypatch):
    monkeypatch.setenv("APP_COMMIT", "abc1234")
    monkeypatch.setenv("APP_COMMIT_COUNT", "57")
    monkeypatch.setenv("APP_BUILT_AT", "2026-11-24T10:00:00Z")
    info = version.build_info()
    assert info["commit"] == "abc1234" and info["built_at"] == "2026-11-24T10:00:00Z"
    assert info["version"].endswith(".57")


def test_build_info_without_the_build_args(monkeypatch):
    for name in ("APP_COMMIT", "APP_COMMIT_COUNT", "APP_BUILT_AT"):
        monkeypatch.delenv(name, raising=False)
    info = version.build_info()
    assert info["commit"] == "" and info["built_at"] is None
    assert info["version"].count(".") == 2


def test_route_needs_a_verified_session_and_has_a_fixed_shape(client, add_user):
    assert client.get("/api/version").status_code == 401
    add_user("alice", "alice@example.com")
    assert login(client, "alice").status_code == 200
    r = client.get("/api/version")
    assert r.status_code == 200
    assert set(r.json()) == {"version", "commit", "built_at"}
