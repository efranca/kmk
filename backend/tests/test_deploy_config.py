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


CADDYFILE = DEPLOY / "caddy" / "Caddyfile"


def test_only_the_document_upload_route_may_carry_a_large_body():
    # Plain text check (works without docker): the 64 KB cap stays on /api/*, and 51 MiB appears exactly once, for the
    # raw-body file upload of a document (50 MiB is the file limit in app/documents/limits.py).
    text = CADDYFILE.read_text()
    assert text.count("max_size 51MiB") == 1 and text.count("max_size 64KB") == 1
    upload = text[text.index("@docfile {"):text.index("handle /api/*")]
    assert "method PUT" in upload and "path_regexp ^/api/documents/[0-9]+/file$" in upload and "max_size 51MiB" in upload
    from app.documents.limits import MAX_FILE_BYTES

    assert MAX_FILE_BYTES < 51 * 1024 * 1024
    # ...and the preview picture (at most 100 KB in the API) has its own small allowance.
    from app.documents.limits import MAX_PREVIEW_BYTES

    preview = text[text.index("@docpreview {"):text.index("handle /api/*")]
    assert "path_regexp ^/api/documents/[0-9]+/preview$" in preview and "max_size 128KB" in preview
    assert text.count("max_size 128KB") == 1 and MAX_PREVIEW_BYTES <= 128 * 1000


def test_quote_routes_have_their_own_body_caps():
    text = CADDYFILE.read_text()
    start = text[text.index("@quotestart {"):text.index("handle /api/*")]
    assert "method POST" in start and "path /api/public/quotes" in start and "max_size 256KB" in start
    photo = text[text.index("@quotephoto {"):text.index("handle /api/*")]
    assert "method PUT" in photo and "path_regexp ^/api/public/quotes/[0-9]+/photos$" in photo and "max_size 9MiB" in photo
    from app.quotes.limits import MAX_PHOTO_BYTES

    assert MAX_PHOTO_BYTES < 9 * 1024 * 1024
    # the other caps are untouched
    assert text.count("max_size 64KB") == 1 and text.count("max_size 51MiB") == 1 and text.count("max_size 128KB") == 1
