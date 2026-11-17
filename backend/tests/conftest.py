import os
from pathlib import Path

import pytest


def _load_env() -> None:
    env = Path(__file__).resolve().parents[1] / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


_load_env()

# Tests must never touch the real `kmk` database: force the runtime and migration URLs to kmk_test
# before the app (and its cached settings) is imported.
if os.environ.get("TEST_DATABASE_URL") and os.environ.get("TEST_APP_DATABASE_URL"):
    os.environ["DATABASE_URL"] = os.environ["TEST_APP_DATABASE_URL"]
    os.environ["MIGRATION_DATABASE_URL"] = os.environ["TEST_DATABASE_URL"]
os.environ.setdefault("SESSION_SECRET", "test-secret")

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402

BACKEND = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="session")
def test_database_url() -> str:
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("TEST_DATABASE_URL not set")
    return url


@pytest.fixture(scope="session")
def owner_engine(test_database_url):
    """kmk_test owner: runs migrations and test setup/inspection."""
    engine = create_engine(test_database_url)
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "alembic"))
    command.upgrade(cfg, "head")
    yield engine
    engine.dispose()


@pytest.fixture(scope="session")
def app_engine():
    """kmk_app: the restricted runtime role."""
    url = os.environ.get("TEST_APP_DATABASE_URL")
    if not url:
        pytest.skip("TEST_APP_DATABASE_URL not set")
    engine = create_engine(url)
    yield engine
    engine.dispose()


@pytest.fixture(autouse=True)
def clean_db(request):
    if "owner_engine" not in request.fixturenames:
        yield
        return
    engine = request.getfixturevalue("owner_engine")
    with engine.begin() as c:
        c.execute(text("TRUNCATE users, sessions, login_attempts, audit_log RESTART IDENTITY CASCADE"))
    yield
