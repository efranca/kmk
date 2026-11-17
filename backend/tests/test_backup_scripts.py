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


# ======================= status check =======================

def write_status_file(setup, **kw):
    setup.state.mkdir(parents=True, exist_ok=True)
    data = {"result": "ok", "time": "2026-11-17T02:30:00-05:00", "epoch": str(int(time.time())), "file": "/x/kmk.tar.gpg", "bytes": "1234", "message": "backup written"}
    data.update({k: str(v) for k, v in kw.items()})
    (setup.state / "status").write_text("".join(f"{k}={v}\n" for k, v in data.items()))


def test_status_fresh_ok(setup):
    write_status_file(setup)
    r = run("kmk-backup-status.sh", setup.env)
    assert r.returncode == 0, r.stderr
    assert "ok" in r.stdout and "/x/kmk.tar.gpg" in r.stdout


def test_status_too_old(setup):
    write_status_file(setup, epoch=int(time.time()) - 40 * 3600)
    r = run("kmk-backup-status.sh", setup.env)
    assert r.returncode == 1 and "old" in (r.stdout + r.stderr).lower()
    assert run("kmk-backup-status.sh", setup.env, "--max-age-hours", "48").returncode == 0  # the limit is honored


def test_status_failed_shows_the_message(setup):
    write_status_file(setup, result="failed", message="the mount is gone")
    r = run("kmk-backup-status.sh", setup.env)
    assert r.returncode == 1 and "the mount is gone" in (r.stdout + r.stderr)


def test_status_missing(setup):
    r = run("kmk-backup-status.sh", setup.env)
    assert r.returncode == 1 and "no backup" in (r.stdout + r.stderr).lower()


def test_status_does_not_modify_the_status_file(setup):
    write_status_file(setup, result="failed", message="x")
    before = (setup.state / "status").read_text()
    run("kmk-backup-status.sh", setup.env)
    assert (setup.state / "status").read_text() == before


# ======================= restore rehearsal =======================

RESTORE_DB = "kmk_restore_test_x"


@pytest.fixture
def backup(setup, add_user):
    """A real archive made by the backup script, with three users in the source."""
    for n in ("ann", "bob", "cy"):
        add_user(n, f"{n}@example.com")
    assert run("kmk-backup.sh", setup.env).returncode == 0
    (setup.archive,) = archives(setup)
    setup.restore_env = {**setup.env, "KMK_RESTORE_DB": RESTORE_DB}
    yield setup
    if db_exists(RESTORE_DB):
        psql(f'DROP DATABASE "{RESTORE_DB}" WITH (FORCE)')


def restore(b, *extra, archive=None, key=None):
    return run("kmk-restore.sh", b.restore_env, str(archive or b.archive), "--private-key", str(key or b.key.private), *extra)


def test_restore_into_the_scratch_database(backup):
    r = restore(backup)
    assert r.returncode == 0, r.stderr
    assert "RESTORE OK" in r.stdout
    assert "rows.users: 3" in r.stdout  # the manifest is shown
    assert not db_exists(RESTORE_DB)  # dropped afterwards
    assert list(backup.work.iterdir()) == []  # no plaintext or keyring left behind


def test_restore_keep_scratch_leaves_the_restored_data(backup):
    r = restore(backup, "--keep-scratch")
    assert r.returncode == 0, r.stderr
    assert psql("select count(*) from users", RESTORE_DB) == "3"


def test_restore_extract_only(backup):
    out = backup.tmp / "extracted"
    r = restore(backup, "--extract-only", str(out))
    assert r.returncode == 0, r.stderr
    assert sorted(p.name for p in out.iterdir()) == ["MANIFEST.txt", "deploy.env", "kmk.dump"]
    assert all(oct(p.stat().st_mode)[-3:] == "600" for p in out.iterdir())
    assert not db_exists(RESTORE_DB)  # extract-only never touches the database
    assert list(backup.work.iterdir()) == []


def test_restore_with_the_wrong_key_fails_cleanly(backup, tmp_path_factory):
    other_home = tmp_path_factory.mktemp("gnupg_other")
    other_home.chmod(0o700)
    env = {**os.environ, "GNUPGHOME": str(other_home)}
    gpg = ["gpg", "--batch", "--pinentry-mode", "loopback", "--passphrase", ""]
    subprocess.run([*gpg, "--quick-generate-key", "Other <other@example.invalid>", "default", "default", "never"], env=env, check=True, capture_output=True)
    wrong = other_home / "private.asc"
    subprocess.run([*gpg, "--export-secret-keys", "--armor", "--output", str(wrong)], env=env, check=True)
    r = restore(backup, key=wrong)
    subprocess.run(["gpgconf", "--kill", "all"], env=env)
    assert r.returncode == 1 and r.stderr.strip()
    assert not db_exists(RESTORE_DB) and list(backup.work.iterdir()) == []


def test_restore_of_a_tampered_archive_fails(backup):
    data = bytearray(backup.archive.read_bytes())
    data[len(data) // 2] ^= 0xFF
    bad = backup.tmp / "tampered.tar.gpg"
    bad.write_bytes(bytes(data))
    r = restore(backup, archive=bad)
    assert r.returncode == 1
    assert not db_exists(RESTORE_DB) and list(backup.work.iterdir()) == []


def test_restore_detects_a_manifest_that_does_not_match_the_data(backup):
    out = decrypt(backup.archive, backup.key, backup.tmp / "edit")
    manifest = (out / "MANIFEST.txt").read_text().replace("rows.users: 3", "rows.users: 99")
    (out / "MANIFEST.txt").write_text(manifest)
    tampered_tar = backup.tmp / "edited.tar"
    with tarfile.open(tampered_tar, "w") as t:
        for name in ("kmk.dump", "deploy.env", "MANIFEST.txt"):
            t.add(out / name, arcname=name)
    env = {**os.environ, "GNUPGHOME": str(backup.key.home)}
    forged = backup.tmp / "forged.tar.gpg"
    subprocess.run(["gpg", "--batch", "--yes", "--trust-model", "always", "--encrypt", "--recipient", backup.key.fpr, "--output", str(forged), str(tampered_tar)], env=env, check=True, capture_output=True)
    r = restore(backup, archive=forged)
    assert r.returncode == 1
    assert "users" in (r.stdout + r.stderr) and "RESTORE OK" not in r.stdout
    assert not db_exists(RESTORE_DB)


def test_restore_never_touches_the_backup_status_file(backup):
    before = (backup.state / "status").read_text()
    restore(backup, archive=backup.tmp / "does-not-exist.tar.gpg")  # a failing restore
    assert (backup.state / "status").read_text() == before


# ======================= key ceremony =======================

def keygen(setup, *extra, private=None, public=None):
    env = {**setup.env, "KMK_KEYGEN_TEST_NOPASS": "1"}
    private = private or setup.tmp / "private.asc"
    public = public or setup.tmp / "recipient.pub.asc"
    r = run("make-backup-key.sh", env, "--private-out", str(private), "--public-out", str(public), *extra)
    return r, private, public


def test_key_ceremony_roundtrip(setup):
    r, private, public = keygen(setup)
    assert r.returncode == 0, r.stderr
    assert oct(private.stat().st_mode)[-3:] == "600"
    assert public.exists() and "BEGIN PGP PUBLIC KEY BLOCK" in public.read_text()
    assert "BEGIN PGP PRIVATE KEY BLOCK" not in public.read_text()
    shown = subprocess.run(["gpg", "--show-keys", "--with-colons", str(public)], capture_output=True, text=True).stdout
    fpr = next(line.split(":")[9] for line in shown.splitlines() if line.startswith("fpr:"))
    assert fpr in r.stdout  # the fingerprint is printed
    assert list(setup.work.iterdir()) == []  # the temporary keyring is gone

    # encrypt with only the public key, decrypt with only the private key
    pub_home, priv_home = setup.tmp / "g_pub", setup.tmp / "g_priv"
    for h in (pub_home, priv_home):
        h.mkdir(mode=0o700)
    sample = setup.tmp / "sample.txt"
    sample.write_text("hello backups")
    pub_env, priv_env = {**os.environ, "GNUPGHOME": str(pub_home)}, {**os.environ, "GNUPGHOME": str(priv_home)}
    subprocess.run(["gpg", "--batch", "--import", str(public)], env=pub_env, check=True, capture_output=True)
    enc = setup.tmp / "sample.gpg"
    subprocess.run(["gpg", "--batch", "--trust-model", "always", "--encrypt", "--recipient", fpr, "--output", str(enc), str(sample)], env=pub_env, check=True, capture_output=True)
    cant = subprocess.run(["gpg", "--batch", "--decrypt", str(enc)], env=pub_env, capture_output=True)
    assert cant.returncode != 0  # the public keyring cannot read it
    subprocess.run(["gpg", "--batch", "--import", str(private)], env=priv_env, check=True, capture_output=True)
    plain = subprocess.run(["gpg", "--batch", "--decrypt", str(enc)], env=priv_env, capture_output=True, text=True)
    assert plain.stdout == "hello backups"
    for env in (pub_env, priv_env):
        subprocess.run(["gpgconf", "--kill", "all"], env=env)


def test_key_ceremony_refuses_to_overwrite(setup):
    r, private, public = keygen(setup)
    assert r.returncode == 0
    before_private, before_public = private.read_bytes(), public.read_bytes()
    again, _, _ = keygen(setup, private=private, public=setup.tmp / "other.pub.asc")
    assert again.returncode == 1 and private.read_bytes() == before_private
    again, _, _ = keygen(setup, private=setup.tmp / "second.asc", public=public)  # would replace the recipient: refused
    assert again.returncode == 1 and public.read_bytes() == before_public
    assert not (setup.tmp / "second.asc").exists()


def test_key_ceremony_requires_a_private_out_path(setup):
    r = run("make-backup-key.sh", {**setup.env, "KMK_KEYGEN_TEST_NOPASS": "1"})
    assert r.returncode != 0


# ======================= scheduling and failure notification =======================

def render_units(setup, *extra):
    out = setup.tmp / "units"
    r = run("install.sh", setup.env, "--render-to", str(out), *extra)
    return r, out


def test_units_are_rendered_with_the_repository_path(setup):
    r, out = render_units(setup)
    assert r.returncode == 0, r.stderr
    names = sorted(p.name for p in out.iterdir())
    assert names == ["kmk-backup-alert.service", "kmk-backup.service", "kmk-backup.timer"]
    service = (out / "kmk-backup.service").read_text()
    timer = (out / "kmk-backup.timer").read_text()
    alert = (out / "kmk-backup-alert.service").read_text()
    assert f"ExecStart={REPO}/deploy/backup/kmk-backup.sh" in service
    assert f"ExecStart={REPO}/deploy/backup/notify-failure.sh" in alert
    assert "OnFailure=kmk-backup-alert.service" in service
    assert "OnCalendar=*-*-* 02:30:00" in timer and "Persistent=true" in timer and "RandomizedDelaySec=10min" in timer
    assert all("@REPO@" not in (out / n).read_text() for n in names)
    assert os.access(REPO / "deploy/backup/kmk-backup.sh", os.X_OK) and os.access(REPO / "deploy/backup/notify-failure.sh", os.X_OK)


@pytest.mark.skipif(not shutil.which("systemd-analyze"), reason="systemd-analyze not available")
def test_rendered_units_pass_systemd_verify(setup):
    _, out = render_units(setup)
    r = subprocess.run(
        ["systemd-analyze", "--user", "verify", *(str(p) for p in sorted(out.iterdir()))],
        capture_output=True, text=True, env={**os.environ, "SYSTEMD_LOG_LEVEL": "warning"},
    )
    assert r.returncode == 0, r.stderr


def test_dry_run_prints_the_plan_and_touches_nothing(setup):
    unit_dir = setup.tmp / "user-units"
    r = run("install.sh", {**setup.env, "KMK_BACKUP_UNIT_DIR": str(unit_dir)}, "--dry-run")
    assert r.returncode == 0, r.stderr
    assert "systemctl --user enable --now kmk-backup.timer" in r.stdout
    assert "OnCalendar=*-*-* 02:30:00" in r.stdout and str(REPO) in r.stdout
    assert not unit_dir.exists()  # nothing was installed


def test_install_refuses_without_the_recipient_key(setup):
    r = run("install.sh", {**setup.env, "KMK_BACKUP_UNIT_DIR": str(setup.tmp / "u"), "KMK_BACKUP_RECIPIENT_FILE": str(setup.tmp / "none.asc")})
    assert r.returncode == 1 and "make-backup-key" in r.stderr
    assert not (setup.tmp / "u").exists()


def fake_notifier(tmp: Path, exit_code: int) -> Path:
    bin_dir = tmp / "bin"
    bin_dir.mkdir()
    log = tmp / "notify.log"
    script = bin_dir / "notify-send"
    script.write_text(f'#!/bin/sh\nprintf "%s\\n" "$@" >> "{log}"\nexit {exit_code}\n')
    script.chmod(0o755)
    return bin_dir


def test_notify_failure_shows_the_failure_message(setup):
    write_status_file(setup, result="failed", message="the mount is gone")
    bin_dir = fake_notifier(setup.tmp, 0)
    r = run("notify-failure.sh", {**setup.env, "PATH": f"{bin_dir}:{os.environ['PATH']}"})
    assert r.returncode == 0, r.stderr
    sent = (setup.tmp / "notify.log").read_text()
    assert "the mount is gone" in sent and "critical" in sent
    assert "SECRET_TEST_VALUE" not in sent + r.stdout + r.stderr


def test_notify_failure_never_fails(setup):
    write_status_file(setup, result="failed", message="x")
    bin_dir = fake_notifier(setup.tmp, 1)  # the notifier itself fails
    assert run("notify-failure.sh", {**setup.env, "PATH": f"{bin_dir}:{os.environ['PATH']}"}).returncode == 0
    assert run("notify-failure.sh", {**setup.env, "KMK_NOTIFY_BIN": "no-such-notifier"}).returncode == 0  # no notifier at all
    empty = setup.tmp / "empty-state"
    assert run("notify-failure.sh", {**setup.env, "KMK_BACKUP_STATE_DIR": str(empty), "KMK_NOTIFY_BIN": "no-such-notifier"}).returncode == 0  # no status file
