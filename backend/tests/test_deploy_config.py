"""Checks on deploy/docker-compose.yml as Docker Compose resolves it (keys only: values, which include secrets, are never printed)."""

import json
import shutil
import subprocess
from pathlib import Path

import pytest

DEPLOY = Path(__file__).resolve().parents[2] / "deploy"
DOCKERFILE = Path(__file__).resolve().parents[1] / "Dockerfile"

pytestmark = pytest.mark.skipif(
    not (shutil.which("docker") and (DEPLOY / ".env").exists()), reason="needs docker compose and deploy/.env"
)


@pytest.fixture(scope="module")
def compose():
    r = subprocess.run(["docker", "compose", "config", "--format", "json"], cwd=DEPLOY, capture_output=True, text=True)
    assert r.returncode == 0, "docker compose config failed"
    return json.loads(r.stdout)["services"]


def test_the_api_never_receives_the_database_owner_credentials(compose):
    """Review F9: with the owner role in its environment, an app compromise could erase its own audit rows."""
    api = compose["api"]
    assert "env_file" not in api
    assert "MIGRATION_DATABASE_URL" not in api["environment"]
    assert {"DATABASE_URL", "SESSION_SECRET"} <= set(api["environment"])


def test_migrations_run_in_their_own_one_shot_service(compose):
    migrate = compose["migrate"]
    assert migrate["command"] == ["alembic", "upgrade", "head"]
    assert migrate.get("restart") == "no"
    assert "MIGRATION_DATABASE_URL" in migrate["environment"]
    assert compose["api"]["depends_on"]["migrate"]["condition"] == "service_completed_successfully"
    cmd = next(line for line in DOCKERFILE.read_text().splitlines() if line.startswith("CMD"))
    assert "alembic" not in cmd  # the long-running container no longer migrates


@pytest.mark.parametrize("service", ["api", "caddy", "migrate"])
def test_containers_are_hardened(compose, service):
    """Review F5 / F24 (part): no capabilities, no privilege escalation; the long-running ones have memory and process limits."""
    svc = compose[service]
    assert svc["cap_drop"] == ["ALL"]
    assert "no-new-privileges:true" in svc["security_opt"]
    if service != "migrate":
        assert int(svc["mem_limit"]) > 0 and int(svc["pids_limit"]) > 0


def test_logs_and_health_checks_are_still_configured(compose):
    for service in ("api", "caddy"):
        assert compose[service]["logging"]["options"] == {"max-size": "10m", "max-file": "5"}
        assert "healthcheck" in compose[service]


def test_build_info_is_baked_into_the_api_image_not_passed_at_runtime(compose):
    # Empty build args are dropped from `compose config`, so the build section is checked in the file itself.
    text = (DEPLOY / "docker-compose.yml").read_text()
    for name in ("APP_COMMIT", "APP_COMMIT_COUNT", "APP_BUILT_AT"):
        assert f"{name}: ${{{name}:-}}" in text
        assert name not in compose["api"]["environment"]
