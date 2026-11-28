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


def test_visit_photos_have_their_own_body_cap():
    text = CADDYFILE.read_text()
    assert text.count("\n\t@visitphoto {") == 1 and text.count("max_size 768KB") == 1
    block = text[text.index("\t@visitphoto {"):text.index("handle /api/*")]
    assert "method PUT" in block and "path_regexp ^/api/visits/[0-9]+/[0-9-]+/photos$" in block and "max_size 768KB" in block
    from app.visits.limits import MAX_PHOTO_BYTES

    assert MAX_PHOTO_BYTES < 768 * 1000
    # the other counted caps are unchanged
    assert text.count("max_size 64KB") == 1 and text.count("max_size 51MiB") == 1 and text.count("max_size 128KB") == 1


def test_visit_photos_volume_and_setting_are_on_the_api_only(compose):
    assert compose["api"]["environment"]["VISIT_PHOTOS_DIR"] == "/data/visit-photos"
    assert "/data/visit-photos" in [v["target"] for v in compose["api"].get("volumes", [])]
    for name, svc in compose.items():
        if name != "api":
            assert all(v["target"] != "/data/visit-photos" for v in svc.get("volumes", [])), name


PHOTOS_BIND = "${KMK_VISIT_PHOTOS_HOST_DIR:-/var/lib/kmk/visit-photos}:/data/visit-photos"


def test_visit_photos_live_at_one_absolute_host_path(compose):
    """Ruling R13: auto-deploy runs compose from a disposable worktree, so a relative bind would land in that worktree
    (created by Docker as root). The source is absolute, the same default the backup reads (deploy/backup/lib.sh)."""
    (bind,) = [v for v in compose["api"]["volumes"] if v["target"] == "/data/visit-photos"]
    assert bind["type"] == "bind" and bind["source"].startswith("/"), bind["source"]
    text = (DEPLOY / "docker-compose.yml").read_text()
    assert text.count(PHOTOS_BIND) == 1 and "./data/visit-photos" not in text
    default = PHOTOS_BIND.split(":-", 1)[1].split("}", 1)[0]
    assert default == "/var/lib/kmk/visit-photos"
    lib = (DEPLOY / "backup" / "lib.sh").read_text()
    assert f"${{KMK_VISIT_PHOTOS_HOST_DIR:-{default}}}" in lib  # the backup reads the very same folder


def test_devis_serves_the_quote_page():
    text = CADDYFILE.read_text()
    block = text[text.index("@devis path"):text.index("handle /assets/*")]
    assert "/devis /devis/" in block and "rewrite * /quote.html" in block and "file_server" in block


def test_csp_allows_the_manifest_and_service_worker_but_nothing_else_new():
    text = CADDYFILE.read_text()
    csp = next(line for line in text.splitlines() if "Content-Security-Policy" in line)
    assert "manifest-src 'self'" in csp and "worker-src 'self'" in csp
    # still closed: scripts, styles, fonts, images and connections only from the app itself (images also as data: URLs)
    for part in ("default-src 'none'", "script-src 'self'", "style-src 'self'", "img-src 'self' data:", "font-src 'self'", "connect-src 'self'", "frame-ancestors 'none'"):
        assert part in csp


def test_the_service_worker_and_manifest_are_real_files_in_the_build():
    public = Path(__file__).resolve().parents[2] / "frontend" / "public"
    for name in ("sw.js", "manifest.webmanifest", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png"):
        assert (public / name).is_file(), name
