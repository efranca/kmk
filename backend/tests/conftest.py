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

# Argon2 at production strength (64 MiB, 3 passes) costs ~36 ms per hash or login, which adds up over a thousand tests.
# Tests hash with the cheapest valid settings; production code is untouched, and hashes made with other settings
# still verify because the parameters are stored inside each hash.
from argon2 import PasswordHasher  # noqa: E402

import app.security as _security  # noqa: E402

_security._hasher = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1)

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


def _delete_plan(engine) -> tuple[list[str], str | None]:
    """Every table except alembic_version, children before parents, plus one statement that rewinds the sequences.

    Computed from the catalog so a new table is cleaned without touching this file. TRUNCATE ... RESTART IDENTITY takes
    about 800 ms on this server (it rewrites every table's files), while DELETE on these tiny tables takes a few ms.
    """
    with engine.connect() as c:
        tables = [r[0] for r in c.execute(text("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'alembic_version'"))]
        deps = {t: set() for t in tables}  # table -> tables that must be emptied before it (those that reference it)
        for child, parent in c.execute(
            text("SELECT conrelid::regclass::text, confrelid::regclass::text FROM pg_constraint WHERE contype = 'f'")
        ):
            if child != parent and child in deps and parent in deps:
                deps[parent].add(child)
        seqs = [r[0] for r in c.execute(text("SELECT quote_ident(schemaname) || '.' || quote_ident(sequencename) FROM pg_sequences WHERE schemaname = 'public'"))]
    order: list[str] = []
    done: set[str] = set()

    def visit(t: str, stack: tuple[str, ...] = ()) -> None:
        if t in done:
            return
        if t in stack:
            raise RuntimeError(f"foreign key cycle through {t}: clean_db needs a different strategy")
        for child in sorted(deps[t]):
            visit(child, stack + (t,))
        done.add(t)
        order.append(t)

    for t in sorted(tables):
        visit(t)
    rewind = "SELECT " + ", ".join(f"setval('{s}', 1, false)" for s in seqs) if seqs else None
    return order, rewind


_plans: dict[int, tuple[list[str], str | None]] = {}


def _reset(engine) -> None:
    if id(engine) not in _plans:
        _plans[id(engine)] = _delete_plan(engine)
    order, rewind = _plans[id(engine)]
    with engine.begin() as c:
        for table in order:
            c.execute(text(f'DELETE FROM "{table}"'))
        if rewind:
            c.execute(text(rewind))


@pytest.fixture(autouse=True)
def clean_db(request):
    if "owner_engine" not in request.fixturenames:
        yield
        return
    _reset(request.getfixturevalue("owner_engine"))
    yield


@pytest.fixture
def reset_db(owner_engine):
    """Empties the database again in the middle of a test (fast: see `_delete_plan`)."""
    return lambda: _reset(owner_engine)


@pytest.fixture
def make_client(owner_engine):
    from fastapi.testclient import TestClient
    from sqlalchemy.pool import NullPool

    from app.main import create_app
    from helpers import make_settings

    def _make(peer="127.0.0.1", **kw):
        settings = make_settings(**kw)
        app = create_app(settings=settings)
        # The Postgres server is shared with other apps: test apps must not keep pooled connections around.
        app.state.engine.dispose()
        app.state.engine = create_engine(settings.database_url, poolclass=NullPool)
        return TestClient(app, client=(peer, 50000))

    return _make


@pytest.fixture
def client(make_client):
    return make_client()


@pytest.fixture
def add_user(owner_engine):
    from app.security import hash_password
    from helpers import PW

    def _add(
        username="alice",
        email="alice@example.com",
        password: str | None = PW,
        status="active",
        role="user",
        locale="fr-CA",
    ):
        with owner_engine.begin() as c:
            c.execute(
                text(
                    "INSERT INTO users (username, email, password_hash, role, locale, status) "
                    "VALUES (:u, :e, :h, :r, :l, :s) "
                ),
                dict(u=username, e=email, h=hash_password(password) if password else None, r=role, l=locale, s=status),
            )

    return _add


@pytest.fixture
def outbox(monkeypatch):
    """Collects emails instead of sending them."""
    import app.emails.sender as sender

    sent = []
    monkeypatch.setattr(sender, "send_email", lambda message, settings, *a, **k: sent.append(message) or True)
    return sent


@pytest.fixture
def make_token(owner_engine, app_engine):
    from datetime import timedelta

    from sqlalchemy.orm import Session

    from app.auth import tokens

    def _make(username: str, purpose: str = "reset", ttl: timedelta = timedelta(minutes=30)) -> str:
        with owner_engine.begin() as c:
            uid = c.execute(text("SELECT id FROM users WHERE username = :u"), {"u": username}).scalar()
        with Session(app_engine) as db:
            raw = tokens.issue_token(db, uid, purpose, ttl)
            db.commit()
        return raw

    return _make


@pytest.fixture
def mfa_key():
    from helpers import TEST_MFA_KEY

    return TEST_MFA_KEY


@pytest.fixture
def add_mfa_user(owner_engine, add_user):
    """Creates a user with TOTP enabled and 10 recovery codes; returns the plaintext TOTP secret.

    The user's plaintext recovery codes are available as `add_mfa_user.codes[username]`.
    """
    from app import mfa
    from helpers import PW, TEST_MFA_KEY

    def _add(username="alice", email=None, role="user", password=PW, locale="fr-CA", status="active") -> str:
        add_user(username, email or f"{username}@example.com", password=password, status=status, role=role, locale=locale)
        secret, codes = mfa.new_secret(), mfa.new_recovery_codes()
        with owner_engine.begin() as c:
            c.execute(
                text("UPDATE users SET mfa_enabled = true, mfa_secret = :s WHERE username = :u"),
                {"s": mfa.encrypt_secret(secret, TEST_MFA_KEY), "u": username},
            )
            uid = c.execute(text("SELECT id FROM users WHERE username = :u"), {"u": username}).scalar()
            for code in codes:
                c.execute(
                    text("INSERT INTO recovery_codes (user_id, code_hash) VALUES (:u, :h)"),
                    {"u": uid, "h": mfa.hash_recovery_code(code)},
                )
        _add.codes[username] = codes
        return secret

    _add.codes = {}
    return _add
