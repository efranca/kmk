"""Tests for the backup scripts in deploy/backup/ (run through subprocess against kmk_test and temporary directories)."""

import os
import shutil
import subprocess
import tarfile
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

SCRIPTS = Path(__file__).resolve().parents[2] / "deploy" / "backup"
REPO = SCRIPTS.parents[1]


def _postgres_running() -> bool:
    if not shutil.which("docker"):
        return False
    r = subprocess.run(["docker", "inspect", "-f", "{{.State.Running}}", "postgres"], capture_output=True, text=True)
    return r.stdout.strip() == "true"


pytestmark = pytest.mark.skipif(
    not (shutil.which("gpg") and _postgres_running()), reason="needs gpg and the shared postgres container"
)

SCRATCH = "kmk_backup_verify_test"


def psql(sql: str, db: str = "postgres") -> str:
    r = subprocess.run(
        ["docker", "exec", "-i", "postgres", "psql", "-U", "postgres", "-d", db, "-Atqc", sql],
        capture_output=True, text=True, stdin=subprocess.DEVNULL,
    )
    assert r.returncode == 0, r.stderr
    return r.stdout.strip()


def db_exists(name: str) -> bool:
    return psql(f"select count(*) from pg_database where datname = '{name}'") == "1"


@pytest.fixture(scope="session")
def test_key(tmp_path_factory):
    """A throwaway gpg key pair (no passphrase): public file for the scripts, keyring for decrypting in tests."""
    home = tmp_path_factory.mktemp("gnupg")
    home.chmod(0o700)
    env = {**os.environ, "GNUPGHOME": str(home)}
    gpg = ["gpg", "--batch", "--pinentry-mode", "loopback", "--passphrase", ""]
    subprocess.run([*gpg, "--quick-generate-key", "KMK Test <test@example.invalid>", "default", "default", "never"], env=env, check=True, capture_output=True)
    public = home / "public.asc"
    private = home / "private.asc"
    subprocess.run([*gpg, "--export", "--armor", "--output", str(public)], env=env, check=True)
    subprocess.run([*gpg, "--export-secret-keys", "--armor", "--output", str(private)], env=env, check=True)
    fpr = subprocess.run(["gpg", "--with-colons", "--list-keys"], env=env, capture_output=True, text=True).stdout
    fpr = next(line.split(":")[9] for line in fpr.splitlines() if line.startswith("fpr:"))
    yield SimpleNamespace(home=home, public=public, private=private, fpr=fpr)
    subprocess.run(["gpgconf", "--kill", "all"], env=env)


def decrypt(archive: Path, key, out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    tar_path = out_dir / "archive.tar"
    env = {**os.environ, "GNUPGHOME": str(key.home)}
    subprocess.run(
        ["gpg", "--batch", "--pinentry-mode", "loopback", "--passphrase", "", "--decrypt", "--output", str(tar_path), str(archive)],
        env=env, check=True, capture_output=True,
    )
    with tarfile.open(tar_path) as t:
        t.extractall(out_dir, filter="data")
    return out_dir


@pytest.fixture
def setup(tmp_path, test_key):
    """Paths and the base environment for one script run."""
    work = tmp_path / "work"
    work.mkdir()
    envfile = tmp_path / "deploy.env"
    envfile.write_text("SECRET_TEST_VALUE=abc123-do-not-leak\n")
    s = SimpleNamespace(
        tmp=tmp_path, dest=tmp_path / "dest", state=tmp_path / "state", work=work, envfile=envfile, key=test_key,
    )
    s.env = {
        **os.environ,
        "KMK_BACKUP_DEST": str(s.dest),
        "KMK_BACKUP_REQUIRE_MOUNT": "",
        "KMK_BACKUP_DB": "kmk_test",
        "KMK_BACKUP_SCRATCH_DB": SCRATCH,
        "KMK_BACKUP_ENV_FILE": str(envfile),
        "KMK_BACKUP_RECIPIENT_FILE": str(test_key.public),
        "KMK_BACKUP_STATE_DIR": str(s.state),
        "KMK_BACKUP_TMP": str(work),
    }
    yield s
    if db_exists(SCRATCH):  # a failing test must not leave the scratch database behind
        psql(f'DROP DATABASE "{SCRATCH}" WITH (FORCE)')


def run(script: str, env: dict, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["bash", str(SCRIPTS / script), *args], env=env, capture_output=True, text=True, timeout=300)


def status_of(setup) -> dict:
    lines = (setup.state / "status").read_text().splitlines()
    return dict(line.split("=", 1) for line in lines if "=" in line)


def archives(setup, folder="daily") -> list[Path]:
    d = setup.dest / folder
    return sorted(d.glob("kmk-*.tar.gpg")) if d.exists() else []


# ---- a good run ----

def test_run_produces_a_decryptable_archive(setup, add_user):
    for n in ("ann", "bob", "cy"):
        add_user(n, f"{n}@example.com")
    r = run("kmk-backup.sh", setup.env)
    assert r.returncode == 0, r.stderr
    (archive,) = archives(setup)
    raw = archive.read_bytes()
    assert b"PGDMP" not in raw and b"SECRET_TEST_VALUE" not in raw  # encrypted, not just packaged

    out = decrypt(archive, setup.key, setup.tmp / "out")
    assert sorted(p.name for p in out.iterdir() if p.name != "archive.tar") == ["MANIFEST.txt", "deploy.env", "kmk.dump"]
    assert (out / "deploy.env").read_text() == setup.envfile.read_text()
    manifest = dict(line.split(": ", 1) for line in (out / "MANIFEST.txt").read_text().splitlines() if ": " in line)
    assert manifest["rows.users"] == "3"
    assert manifest["alembic_revision"] == "0004"
    assert manifest["db"] == "kmk_test"
    import hashlib

    assert manifest["dump_sha256"] == hashlib.sha256((out / "kmk.dump").read_bytes()).hexdigest()
    tables = {k.removeprefix("rows.") for k in manifest if k.startswith("rows.")}
    assert {"users", "sessions", "tokens", "audit_log", "login_attempts", "recovery_codes", "alembic_version"} <= tables


def test_status_and_cleanliness(setup, add_user):
    add_user()
    assert run("kmk-backup.sh", setup.env).returncode == 0
    status = status_of(setup)
    (archive,) = archives(setup)
    assert status["result"] == "ok" and status["file"] == str(archive) and int(status["bytes"]) == archive.stat().st_size
    assert (setup.dest / "STATUS").read_text() == (setup.state / "status").read_text()
    assert not db_exists(SCRATCH)  # the scratch database is gone
    assert list(setup.work.iterdir()) == []  # no plaintext or keyring left in the temporary directory
    assert sorted(p.name for p in setup.dest.iterdir()) == ["STATUS", "daily"]  # no weekly folder on a weekday, no .partial files


# ---- refusals and failures ----

def test_refuses_without_a_mount(setup):
    r = run("kmk-backup.sh", {**setup.env, "KMK_BACKUP_REQUIRE_MOUNT": "/definitely/not/a/mountpoint"})
    assert r.returncode == 1
    assert "mount" in r.stderr.lower()
    assert not setup.dest.exists()  # nothing was created or written at the destination
    assert status_of(setup)["result"] == "failed"


@pytest.mark.parametrize(
    "case",
    ["missing_recipient", "garbage_recipient", "missing_env_file", "no_such_container", "no_such_database"],
)
def test_each_missing_prerequisite_fails_loudly(setup, case):
    env = dict(setup.env)
    if case == "missing_recipient":
        env["KMK_BACKUP_RECIPIENT_FILE"] = str(setup.tmp / "nope.asc")
    elif case == "garbage_recipient":
        bad = setup.tmp / "bad.asc"
        bad.write_text("this is not a key\n")
        env["KMK_BACKUP_RECIPIENT_FILE"] = str(bad)
    elif case == "missing_env_file":
        env["KMK_BACKUP_ENV_FILE"] = str(setup.tmp / "no.env")
    elif case == "no_such_container":
        env["KMK_BACKUP_PG_CONTAINER"] = "no-such-container"
    else:
        env["KMK_BACKUP_DB"] = "no_such_db"
    r = run("kmk-backup.sh", env)
    assert r.returncode == 1 and r.stderr.strip()
    assert archives(setup) == []
    status = status_of(setup)
    assert status["result"] == "failed" and status["message"]
    assert list(setup.work.iterdir()) == []


def test_a_damaged_dump_is_caught(setup, add_user):
    add_user()
    r = run("kmk-backup.sh", {**setup.env, "KMK_BACKUP_TEST_TRUNCATE_DUMP": "1"})
    assert r.returncode == 1
    assert archives(setup) == []
    assert status_of(setup)["result"] == "failed"
    assert not db_exists(SCRATCH)


def test_row_count_comparison_detects_differences(setup, add_user):
    add_user()
    empty = "kmk_cmp_empty_test"
    psql(f'DROP DATABASE IF EXISTS "{empty}" WITH (FORCE)')
    psql(f'CREATE DATABASE "{empty}" TEMPLATE template0')
    try:
        def compare(a, b):
            return subprocess.run(
                ["bash", "-c", f'source "{SCRIPTS}/lib.sh"; compare_counts {a} {b}'], env=setup.env, capture_output=True, text=True
            )

        same = compare("kmk_test", "kmk_test")
        assert same.returncode == 0 and same.stdout.strip() == ""
        different = compare("kmk_test", empty)
        assert different.returncode == 1 and "users" in different.stdout
    finally:
        psql(f'DROP DATABASE IF EXISTS "{empty}" WITH (FORCE)')


# ---- weekly copy and retention ----

def test_weekly_copy_only_on_sundays(setup, add_user):
    add_user()
    assert run("kmk-backup.sh", {**setup.env, "KMK_BACKUP_NOW": "2026-11-22 02:30:00"}).returncode == 0  # a Sunday
    (daily,) = archives(setup)
    (weekly,) = archives(setup, "weekly")
    assert daily.name == weekly.name == "kmk-2026-11-22_023000.tar.gpg"
    assert daily.read_bytes() == weekly.read_bytes()
    assert run("kmk-backup.sh", {**setup.env, "KMK_BACKUP_NOW": "2026-11-23 02:30:00"}).returncode == 0  # a Monday
    assert len(archives(setup)) == 2 and len(archives(setup, "weekly")) == 1


def _seed(setup, folder, count):
    d = setup.dest / folder
    d.mkdir(parents=True, exist_ok=True)
    now = time.time()
    names = []
    for i in range(count):
        f = d / f"kmk-2026-01-{i + 1:02d}_000000.tar.gpg"
        f.write_bytes(b"old")
        age = (count - i + 40) * 86400  # i = 0 is the oldest
        os.utime(f, (now - age, now - age))
        names.append(f.name)
    return names


def test_retention_keeps_the_newest(setup, add_user):
    add_user()
    old_daily = _seed(setup, "daily", 20)
    old_weekly = _seed(setup, "weekly", 10)
    r = run("kmk-backup.sh", {**setup.env, "KMK_BACKUP_NOW": "2026-11-23 02:30:00"})  # a Monday: no new weekly copy
    assert r.returncode == 0, r.stderr
    daily = [p.name for p in archives(setup)]
    assert len(daily) == 14 and "kmk-2026-11-23_023000.tar.gpg" in daily
    assert not set(old_daily[:7]) & set(daily) and set(old_daily[7:]) <= set(daily)  # the 7 oldest went
    weekly = [p.name for p in archives(setup, "weekly")]
    assert sorted(weekly) == sorted(old_weekly[2:])  # the 2 oldest went


def test_a_failed_run_deletes_nothing(setup):
    old_daily = _seed(setup, "daily", 20)
    r = run("kmk-backup.sh", {**setup.env, "KMK_BACKUP_RECIPIENT_FILE": str(setup.tmp / "nope.asc")})
    assert r.returncode == 1
    assert sorted(p.name for p in archives(setup)) == sorted(old_daily)


# ---- hygiene ----

@pytest.mark.parametrize("script", sorted(p.name for p in SCRIPTS.glob("*.sh")) or ["kmk-backup.sh"])
def test_scripts_pass_the_bash_syntax_check(script):
    assert (SCRIPTS / script).exists(), f"{script} is missing"
    r = subprocess.run(["bash", "-n", str(SCRIPTS / script)], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
