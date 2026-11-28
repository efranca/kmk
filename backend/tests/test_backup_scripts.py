"""Tests for the backup scripts in deploy/backup/ (run through subprocess against kmk_test and temporary directories).

The backup is a plain tar (no encryption) holding the database dump and a manifest; deploy.env is deliberately not in it."""

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


pytestmark = [
    pytest.mark.slow,  # real pg_dump per test: skip with `pytest -m "not slow"`
    pytest.mark.skipif(not _postgres_running(), reason="needs the shared postgres container"),
]

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


def extract(archive: Path, out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive) as t:
        t.extractall(out_dir, filter="data")
    return out_dir


@pytest.fixture
def setup(tmp_path):
    """Paths and the base environment for one script run."""
    work = tmp_path / "work"
    work.mkdir()
    envfile = tmp_path / "deploy.env"
    envfile.write_text("SECRET_TEST_VALUE=abc123-do-not-leak\n")  # must never end up in an archive
    s = SimpleNamespace(
        tmp=tmp_path, dest=tmp_path / "dest", state=tmp_path / "state", work=work, envfile=envfile,
    )
    s.env = {
        **os.environ,
        "KMK_BACKUP_DEST": str(s.dest),
        "KMK_BACKUP_REQUIRE_MOUNT": "",
        "KMK_BACKUP_DB": "kmk_test",
        "KMK_BACKUP_SCRATCH_DB": SCRATCH,
        "KMK_BACKUP_STATE_DIR": str(s.state),
        "KMK_BACKUP_TMP": str(work),
        "KMK_BACKUP_PHOTOS_SRC": str(tmp_path / "photos-src"),  # never the real folder; absent unless a test creates it
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
    return sorted(d.glob("kmk-*.tar")) if d.exists() else []


# ---- a good run ----

def test_run_produces_a_plain_archive_without_secrets(setup, add_user):
    for n in ("ann", "bob", "cy"):
        add_user(n, f"{n}@example.com")
    r = run("kmk-backup.sh", setup.env)
    assert r.returncode == 0, r.stderr
    (archive,) = archives(setup)
    assert archive.name.endswith(".tar") and oct(archive.stat().st_mode)[-3:] == "600"  # it holds password hashes
    assert b"SECRET_TEST_VALUE" not in archive.read_bytes()  # deploy.env is not part of the backup

    out = extract(archive, setup.tmp / "out")
    assert sorted(p.name for p in out.iterdir()) == ["MANIFEST.txt", "kmk.dump"]
    assert (out / "kmk.dump").read_bytes().startswith(b"PGDMP")
    manifest = dict(line.split(": ", 1) for line in (out / "MANIFEST.txt").read_text().splitlines() if ": " in line)
    assert manifest["rows.users"] == "3"
    assert manifest["alembic_revision"] == psql("select version_num from alembic_version", "kmk_test")  # whatever the current revision is
    assert manifest["db"] == "kmk_test"
    import hashlib

    assert manifest["dump_sha256"] == hashlib.sha256((out / "kmk.dump").read_bytes()).hexdigest()
    tables = {k.removeprefix("rows.") for k in manifest if k.startswith("rows.")}
    assert {"users", "sessions", "tokens", "audit_log", "login_attempts", "recovery_codes", "alembic_version"} <= tables


def test_the_backup_does_not_read_the_env_file(setup, add_user):
    add_user()
    setup.envfile.unlink()  # the script must not need (or copy) deploy.env
    assert run("kmk-backup.sh", setup.env).returncode == 0


def test_status_and_cleanliness(setup, add_user):
    add_user()
    assert run("kmk-backup.sh", setup.env).returncode == 0
    status = status_of(setup)
    (archive,) = archives(setup)
    assert status["result"] == "ok" and status["file"] == str(archive) and int(status["bytes"]) == archive.stat().st_size
    assert (setup.dest / "STATUS").read_text() == (setup.state / "status").read_text()
    assert not db_exists(SCRATCH)  # the scratch database is gone
    assert list(setup.work.iterdir()) == []  # nothing left in the temporary directory
    assert sorted(p.name for p in setup.dest.iterdir()) == ["STATUS", "daily"]  # no weekly folder, no .partial files


# ---- refusals and failures ----

def test_refuses_without_a_mount(setup):
    r = run("kmk-backup.sh", {**setup.env, "KMK_BACKUP_REQUIRE_MOUNT": "/definitely/not/a/mountpoint"})
    assert r.returncode == 1
    assert "mount" in r.stderr.lower()
    assert not setup.dest.exists()  # nothing was created or written at the destination
    assert status_of(setup)["result"] == "failed"


@pytest.mark.parametrize(
    "case",
    ["no_such_container", "no_such_database"],
)
def test_each_missing_prerequisite_fails_loudly(setup, case):
    env = dict(setup.env)
    if case == "no_such_container":
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


# ---- retention (the newest 14, about two weeks; no weekly copies) ----

def test_no_weekly_copy_on_sundays(setup, add_user):
    add_user()
    assert run("kmk-backup.sh", {**setup.env, "KMK_BACKUP_NOW": "2026-11-22 02:30:00"}).returncode == 0  # a Sunday
    (daily,) = archives(setup)
    assert daily.name == "kmk-2026-11-22_023000.tar"
    assert not (setup.dest / "weekly").exists()


def _seed(setup, folder, count):
    d = setup.dest / folder
    d.mkdir(parents=True, exist_ok=True)
    now = time.time()
    names = []
    for i in range(count):
        f = d / f"kmk-2026-01-{i + 1:02d}_000000.tar"
        f.write_bytes(b"old")
        age = (count - i + 40) * 86400  # i = 0 is the oldest
        os.utime(f, (now - age, now - age))
        names.append(f.name)
    return names


def test_retention_keeps_the_newest(setup, add_user):
    add_user()
    old_daily = _seed(setup, "daily", 20)
    r = run("kmk-backup.sh", {**setup.env, "KMK_BACKUP_NOW": "2026-11-23 02:30:00"})
    assert r.returncode == 0, r.stderr
    daily = [p.name for p in archives(setup)]
    assert len(daily) == 14 and "kmk-2026-11-23_023000.tar" in daily
    assert not set(old_daily[:7]) & set(daily) and set(old_daily[7:]) <= set(daily)  # the 7 oldest went


def test_a_failed_run_deletes_nothing(setup):
    old_daily = _seed(setup, "daily", 20)
    r = run("kmk-backup.sh", {**setup.env, "KMK_BACKUP_PG_CONTAINER": "no-such-container"})
    assert r.returncode == 1
    assert sorted(p.name for p in archives(setup)) == sorted(old_daily)


def test_an_unexpected_error_still_records_a_failed_status(setup, add_user):
    """Review F8: a failure that is not one of the script's own checks must not leave an old 'ok' status standing."""
    add_user()
    write_status_file(setup, message="an old good run")
    bad_bin = setup.tmp / "badbin"
    bad_bin.mkdir()
    (bad_bin / "mktemp").write_text("#!/bin/sh\nexit 1\n")  # a command the script does not guard with its own `|| fail`
    (bad_bin / "mktemp").chmod(0o755)
    r = run("kmk-backup.sh", {**setup.env, "PATH": f"{bad_bin}:{os.environ['PATH']}"})
    assert r.returncode != 0
    status = status_of(setup)
    assert status["result"] == "failed" and "unexpected" in status["message"]
    assert archives(setup) == []
    assert not db_exists(SCRATCH) and list(setup.work.iterdir()) == []


def test_retention_goes_by_the_name_not_the_modification_time(setup, add_user):
    """Review F6: files with future modification times (NTFS, clock skew) must not push the new backup out."""
    add_user()
    d = setup.dest / "daily"
    d.mkdir(parents=True)
    future = time.time() + 30 * 86400
    for i in range(14):
        f = d / f"kmk-2026-01-{i + 1:02d}_000000.tar"
        f.write_bytes(b"x")
        os.utime(f, (future + i, future + i))
    r = run("kmk-backup.sh", {**setup.env, "KMK_BACKUP_NOW": "2026-11-23 02:30:00"})
    assert r.returncode == 0, r.stderr
    names = [p.name for p in archives(setup)]
    assert "kmk-2026-11-23_023000.tar" in names  # the new backup survives
    assert len(names) == 14 and "kmk-2026-01-01_000000.tar" not in names  # the oldest by NAME went
    assert status_of(setup)["result"] == "ok"


# ---- hygiene ----

@pytest.mark.parametrize("script", sorted(p.name for p in SCRIPTS.glob("*.sh")) or ["kmk-backup.sh"])
def test_scripts_pass_the_bash_syntax_check(script):
    assert (SCRIPTS / script).exists(), f"{script} is missing"
    r = subprocess.run(["bash", "-n", str(SCRIPTS / script)], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr


# ======================= status check =======================

def write_status_file(setup, **kw):
    setup.state.mkdir(parents=True, exist_ok=True)
    data = {"result": "ok", "time": "2026-11-17T02:30:00-05:00", "epoch": str(int(time.time())), "file": "/x/kmk.tar", "bytes": "1234", "message": "backup written"}
    data.update({k: str(v) for k, v in kw.items()})
    (setup.state / "status").write_text("".join(f"{k}={v}\n" for k, v in data.items()))


def test_status_fresh_ok(setup):
    write_status_file(setup)
    r = run("kmk-backup-status.sh", setup.env)
    assert r.returncode == 0, r.stderr
    assert "ok" in r.stdout and "/x/kmk.tar" in r.stdout


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


def restore(b, *extra, archive=None):
    return run("kmk-restore.sh", b.restore_env, str(archive or b.archive), *extra)


def repack(out_dir: Path, tar_path: Path) -> Path:
    with tarfile.open(tar_path, "w") as t:
        for name in ("kmk.dump", "MANIFEST.txt"):
            t.add(out_dir / name, arcname=name)
    return tar_path


def test_restore_into_the_scratch_database(backup):
    r = restore(backup)
    assert r.returncode == 0, r.stderr
    assert "RESTORE OK" in r.stdout
    assert "rows.users: 3" in r.stdout  # the manifest is shown
    assert not db_exists(RESTORE_DB)  # dropped afterwards
    assert list(backup.work.iterdir()) == []  # nothing left behind


def test_restore_keep_scratch_leaves_the_restored_data(backup):
    r = restore(backup, "--keep-scratch")
    assert r.returncode == 0, r.stderr
    assert psql("select count(*) from users", RESTORE_DB) == "3"


def test_restore_extract_only(backup):
    out = backup.tmp / "extracted"
    r = restore(backup, "--extract-only", str(out))
    assert r.returncode == 0, r.stderr
    assert sorted(p.name for p in out.iterdir()) == ["MANIFEST.txt", "kmk.dump"]
    assert all(oct(p.stat().st_mode)[-3:] == "600" for p in out.iterdir())
    assert not db_exists(RESTORE_DB)  # extract-only never touches the database
    assert list(backup.work.iterdir()) == []


def test_restore_of_a_tampered_archive_fails(backup):
    data = bytearray(backup.archive.read_bytes())
    data[len(data) // 2] ^= 0xFF
    bad = backup.tmp / "tampered.tar"
    bad.write_bytes(bytes(data))
    r = restore(backup, archive=bad)
    assert r.returncode == 1
    assert not db_exists(RESTORE_DB) and list(backup.work.iterdir()) == []


def test_restore_detects_a_manifest_that_does_not_match_the_data(backup):
    out = extract(backup.archive, backup.tmp / "edit")
    manifest = (out / "MANIFEST.txt").read_text().replace("rows.users: 3", "rows.users: 99")
    (out / "MANIFEST.txt").write_text(manifest)
    forged = repack(out, backup.tmp / "edited.tar")
    r = restore(backup, "--accept-unverified", archive=forged)
    assert r.returncode == 1
    assert "users" in (r.stdout + r.stderr) and "RESTORE OK" not in r.stdout
    assert not db_exists(RESTORE_DB)


def test_backup_records_the_hash_of_every_archive_it_writes(backup):
    import hashlib

    line = f"{hashlib.sha256(backup.archive.read_bytes()).hexdigest()}  {backup.archive.name}"
    assert line in (backup.state / "archives.sha256").read_text().splitlines()


def test_restore_refuses_an_archive_the_backup_did_not_write(backup):
    """Review F7: anyone who can write to the backup folder could add an archive; restoring runs SQL as the superuser."""
    out = extract(backup.archive, backup.tmp / "same")
    (out / "MANIFEST.txt").write_text((out / "MANIFEST.txt").read_text() + "note: not written by the backup script\n")
    forged = repack(out, backup.tmp / "not-ours.tar")  # a valid, restorable archive whose hash was never recorded
    r = restore(backup, archive=forged)
    assert r.returncode == 1
    assert "not recognised" in r.stderr and "--accept-unverified" in r.stderr
    assert not db_exists(RESTORE_DB)  # nothing was executed on the database server
    assert list(backup.work.iterdir()) == []
    ok = restore(backup, "--accept-unverified", archive=forged)  # the explicit override still works (for example after a reinstall)
    assert ok.returncode == 0 and "RESTORE OK" in ok.stdout and "WARNING" in ok.stderr


def test_restore_never_touches_the_backup_status_file(backup):
    before = (backup.state / "status").read_text()
    restore(backup, archive=backup.tmp / "does-not-exist.tar")  # a failing restore
    assert (backup.state / "status").read_text() == before


# ======================= scheduling and failure notification =======================

def render_units(setup, *extra):
    out = setup.tmp / "units"
    r = run("install.sh", setup.env, "--render-to", str(out), *extra)
    return r, out


def test_units_are_rendered_with_the_repository_path(setup):
    r, out = render_units(setup)
    assert r.returncode == 0, r.stderr
    names = sorted(p.name for p in out.iterdir())
    assert names == [
        "kmk-backup-alert.service", "kmk-backup.service", "kmk-backup.timer",
        "kmk-visit-photos-purge-alert.service", "kmk-visit-photos-purge.service", "kmk-visit-photos-purge.timer",
    ]
    service = (out / "kmk-backup.service").read_text()
    timer = (out / "kmk-backup.timer").read_text()
    alert = (out / "kmk-backup-alert.service").read_text()
    assert f"ExecStart={REPO}/deploy/backup/kmk-backup.sh" in service
    assert f"ExecStart={REPO}/deploy/backup/notify-failure.sh" in alert
    assert "OnFailure=kmk-backup-alert.service" in service
    assert "OnCalendar=*-*-* 02:30:00" in timer and "Persistent=true" in timer and "RandomizedDelaySec=10min" in timer
    assert all("@REPO@" not in (out / n).read_text() for n in names)
    assert os.access(REPO / "deploy/backup/kmk-backup.sh", os.X_OK) and os.access(REPO / "deploy/backup/notify-failure.sh", os.X_OK)


def test_purge_units_are_rendered(setup):
    r, out = render_units(setup)
    assert r.returncode == 0, r.stderr
    service = (out / "kmk-visit-photos-purge.service").read_text()
    timer = (out / "kmk-visit-photos-purge.timer").read_text()
    assert f"docker compose -f {REPO}/deploy/docker-compose.yml exec -T api python -m app.cli purge-visit-photos" in service
    assert "Type=oneshot" in service
    assert "OnCalendar=*-*-* 03:15:00" in timer and "Persistent=true" in timer and "RandomizedDelaySec=10min" in timer
    assert "WantedBy=timers.target" in timer
    dry = run("install.sh", {**setup.env, "KMK_BACKUP_UNIT_DIR": str(setup.tmp / "uu")}, "--dry-run").stdout
    assert "kmk-visit-photos-purge.timer" in dry and "enable --now kmk-visit-photos-purge.timer" in dry
    assert "enable --now kmk-backup.timer" in dry


def test_a_failed_purge_alerts_the_owner(setup):
    """Ruling R17: its own alert unit (the backup alert reads the backup status file, which would say ok)."""
    r, out = render_units(setup)
    assert r.returncode == 0, r.stderr
    service = (out / "kmk-visit-photos-purge.service").read_text()
    alert = (out / "kmk-visit-photos-purge-alert.service").read_text()
    assert "OnFailure=kmk-visit-photos-purge-alert.service" in service
    assert "After=docker.service" not in service  # a user unit cannot order itself against a system unit
    assert "Type=oneshot" in alert and f"ExecStart={REPO}/deploy/backup/notify-failure.sh purge" in alert
    dry = run("install.sh", {**setup.env, "KMK_BACKUP_UNIT_DIR": str(setup.tmp / "uu")}, "--dry-run").stdout
    for name in ("kmk-backup.service", "kmk-backup.timer", "kmk-backup-alert.service", "kmk-visit-photos-purge.service",
                 "kmk-visit-photos-purge.timer", "kmk-visit-photos-purge-alert.service"):
        assert f"### {setup.tmp / 'uu' / name}" in dry, name


def test_notify_failure_for_the_purge_has_its_own_message(setup):
    write_status_file(setup, result="failed", message="the mount is gone")  # the backup's status: not about the purge
    bin_dir = fake_notifier(setup.tmp, 0)
    r = run("notify-failure.sh", {**setup.env, "PATH": f"{bin_dir}:{os.environ['PATH']}"}, "purge")
    assert r.returncode == 0, r.stderr
    sent = (setup.tmp / "notify.log").read_text()
    assert "The photo clean-up (purge) failed: photos older than 6 months may still be on disk" in sent
    assert "journalctl --user -u kmk-visit-photos-purge.service" in sent and "critical" in sent
    assert "the mount is gone" not in sent and "KMK backup FAILED" not in sent
    assert run("notify-failure.sh", {**setup.env, "KMK_NOTIFY_BIN": "no-such-notifier"}, "purge").returncode == 0
    assert run("notify-failure.sh", {**setup.env, "KMK_NOTIFY_BIN": "no-such-notifier"}, "something-else").returncode == 0  # never fails


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


def test_repository_scripts_pass_the_bash_syntax_check():
    scripts = sorted((REPO / "scripts").glob("*.sh"))
    assert scripts, "scripts/ has no shell scripts"
    for path in scripts:
        r = subprocess.run(["bash", "-n", str(path)], capture_output=True, text=True)
        assert r.returncode == 0, f"{path.name}: {r.stderr}"
        assert os.access(path, os.X_OK), f"{path.name} is not executable"


# ======================= photo snapshots =======================

def photo_snapshots(setup) -> list[Path]:
    d = setup.dest / "photos"
    return sorted(p for p in d.iterdir() if p.is_dir()) if d.exists() else []


def make_photos(setup, files: dict[str, bytes]) -> Path:
    src = Path(setup.env["KMK_BACKUP_PHOTOS_SRC"])
    for name, data in files.items():
        f = src / name
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(data)
    return src


def run_at(setup, when: str, **extra):
    return run("kmk-backup.sh", {**setup.env, "KMK_BACKUP_NOW": when, **extra})


def test_photos_are_snapshotted_with_hard_links(setup, add_user):
    add_user()
    src = make_photos(setup, {"a/1.jpg": b"one", "a/2.jpg": b"two"})
    r = run_at(setup, "2026-11-23 02:30:00")
    assert r.returncode == 0, r.stderr
    assert status_of(setup)["message"] == "backup written (photos: 2 files)"
    (src / "a" / "3.jpg").write_bytes(b"three")
    r = run_at(setup, "2026-11-24 02:30:00")
    assert r.returncode == 0, r.stderr
    assert status_of(setup)["message"] == "backup written (photos: 3 files)"
    first, second = photo_snapshots(setup)
    assert first.name == "2026-11-23_023000" and second.name == "2026-11-24_023000"
    assert (first / "a/1.jpg").stat().st_ino == (second / "a/1.jpg").stat().st_ino  # unchanged: one copy on disk
    assert not (first / "a/3.jpg").exists() and (second / "a/3.jpg").read_bytes() == b"three"
    # Each snapshot is complete on its own: removing the old one leaves the newer intact.
    shutil.rmtree(first)
    assert {p.name: p.read_bytes() for p in (second / "a").iterdir()} == {"1.jpg": b"one", "2.jpg": b"two", "3.jpg": b"three"}
    assert not list((setup.dest / "photos").glob("*.partial"))
    assert len(archives(setup)) == 2


def test_photo_snapshots_follow_the_retention(setup, add_user):
    add_user()
    make_photos(setup, {"x.jpg": b"x"})
    photos = setup.dest / "photos"
    photos.mkdir(parents=True)
    for d in ("2026-11-01_023000", "2026-11-02_023000", "2026-11-03_023000"):
        (photos / d).mkdir()
        (photos / d / "old.jpg").write_bytes(b"old")
    (photos / "notes").mkdir()  # stray things are never removed
    (photos / "README.txt").write_text("keep me")
    (photos / "2026-10-01_023000.partial").mkdir()  # a crashed earlier run: cleaned
    os.utime(photos / "2026-11-03_023000", (4102444800, 4102444800))  # a future mtime must not matter
    r = run_at(setup, "2026-11-23 02:30:00", KMK_BACKUP_KEEP_DAILY="2")
    assert r.returncode == 0, r.stderr
    names = sorted(p.name for p in photos.iterdir())
    assert names == ["2026-11-03_023000", "2026-11-23_023000", "README.txt", "notes"]


def test_missing_photo_folder_is_not_a_failure(setup, add_user):
    add_user()
    r = run_at(setup, "2026-11-23 02:30:00")  # the folder does not exist
    assert r.returncode == 0, r.stderr
    assert status_of(setup)["result"] == "ok" and status_of(setup)["message"] == "backup written"
    assert not (setup.dest / "photos").exists()
    Path(setup.env["KMK_BACKUP_PHOTOS_SRC"]).mkdir()  # an empty folder
    r = run_at(setup, "2026-11-24 02:30:00")
    assert r.returncode == 0, r.stderr
    assert status_of(setup)["message"] == "backup written" and photo_snapshots(setup) == []
    r = run_at(setup, "2026-11-25 02:30:00", KMK_BACKUP_PHOTOS_SRC="")
    assert r.returncode == 0, r.stderr
    assert status_of(setup)["message"] == "backup written"


def test_a_failed_photo_step_records_failed_and_deletes_nothing(setup, add_user, tmp_path):
    add_user()
    make_photos(setup, {"x.jpg": b"x"})
    assert run_at(setup, "2026-11-22 02:30:00").returncode == 0
    bindir = tmp_path / "bin"
    bindir.mkdir()
    (bindir / "rsync").write_text("#!/bin/sh\nexit 23\n")
    (bindir / "rsync").chmod(0o755)
    r = run_at(setup, "2026-11-23 02:30:00", KMK_BACKUP_KEEP_DAILY="1", PATH=f"{bindir}:{os.environ['PATH']}")
    assert r.returncode == 1
    assert status_of(setup)["result"] == "failed" and "photo" in status_of(setup)["message"]
    assert len(archives(setup)) == 2  # the new archive stays, the old one was not pruned
    assert [p.name for p in photo_snapshots(setup)] == ["2026-11-22_023000"]  # no partial left, nothing pruned


def fake_rsync(tmp_path, body: str) -> str:
    bindir = tmp_path / "bin"
    bindir.mkdir(exist_ok=True)
    (bindir / "rsync").write_text("#!/bin/bash\n" + body)
    (bindir / "rsync").chmod(0o755)
    return f"{bindir}:{os.environ['PATH']}"


def test_an_unreadable_photo_folder_fails_and_deletes_nothing(setup, add_user):
    add_user()
    src = make_photos(setup, {"a/1.jpg": b"one"})
    assert run_at(setup, "2026-11-22 02:30:00").returncode == 0
    for unreadable in (src, src / "a" / "1.jpg", src / "a"):
        unreadable.chmod(0o000)
        try:
            if os.access(unreadable, os.R_OK) and unreadable.is_file():
                pytest.skip("chmod does not block reads for this user")
            r = run_at(setup, "2026-11-23 02:30:00", KMK_BACKUP_KEEP_DAILY="1")
        finally:
            unreadable.chmod(0o755 if unreadable.is_dir() else 0o644)
        assert r.returncode == 1, unreadable
        assert status_of(setup)["result"] == "failed" and "photo" in status_of(setup)["message"]
        assert str(src) in r.stderr and "1.jpg" not in status_of(setup)["message"]
        assert [p.name for p in photo_snapshots(setup)] == ["2026-11-22_023000"]  # nothing pruned, no partial
        assert not list((setup.dest / "photos").glob("*.partial"))
        assert len(archives(setup)) == 2  # the new archive was kept, the old one not pruned


def test_an_empty_readable_photo_folder_skips_quietly(setup, add_user):
    add_user()
    (Path(setup.env["KMK_BACKUP_PHOTOS_SRC"]) / "a").mkdir(parents=True)
    r = run_at(setup, "2026-11-23 02:30:00")
    assert r.returncode == 0, r.stderr
    assert status_of(setup)["message"] == "backup written" and not (setup.dest / "photos").exists()


def test_rsync_exit_24_is_a_success(setup, add_user, tmp_path):
    add_user()
    make_photos(setup, {"a.jpg": b"x", "b.jpg": b"y"})
    path = fake_rsync(tmp_path, 'real=$(PATH=${PATH#*:} command -v rsync); "$real" "$@"; exit 24\n')
    r = run_at(setup, "2026-11-23 02:30:00", PATH=path)
    assert r.returncode == 0, r.stderr
    assert status_of(setup)["result"] == "ok" and status_of(setup)["message"] == "backup written (photos: 2 files)"
    assert [p.name for p in photo_snapshots(setup)] == ["2026-11-23_023000"]


def test_snapshot_modes_are_private(setup, add_user):
    add_user()
    make_photos(setup, {"a/1.jpg": b"one"})
    src = Path(setup.env["KMK_BACKUP_PHOTOS_SRC"])
    (src / "a" / "1.jpg").chmod(0o644)  # even a world-readable source stays private in the snapshot
    (src / "a").chmod(0o755)
    assert run_at(setup, "2026-11-23 02:30:00").returncode == 0
    (snap,) = photo_snapshots(setup)
    mode = lambda p: p.stat().st_mode & 0o777  # noqa: E731
    assert mode(setup.dest / "photos") == 0o700 and mode(snap) == 0o700 and mode(snap / "a") == 0o700
    assert mode(snap / "a" / "1.jpg") == 0o600


def lib_value(env: dict, name: str) -> str:
    r = subprocess.run(["bash", "-c", f'source "{SCRIPTS}/lib.sh"; printf %s "${name}"'], env=env, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    return r.stdout


def test_the_photo_source_defaults_to_the_folder_the_api_writes(setup):
    """Ruling R13: the same absolute host folder as the api's bind in deploy/docker-compose.yml."""
    base = {k: v for k, v in setup.env.items() if k not in ("KMK_BACKUP_PHOTOS_SRC", "KMK_VISIT_PHOTOS_HOST_DIR")}
    assert lib_value(base, "KMK_BACKUP_PHOTOS_SRC") == "/var/lib/kmk/visit-photos"
    assert lib_value({**base, "KMK_VISIT_PHOTOS_HOST_DIR": "/srv/photos"}, "KMK_BACKUP_PHOTOS_SRC") == "/srv/photos"
    assert lib_value({**base, "KMK_BACKUP_PHOTOS_SRC": ""}, "KMK_BACKUP_PHOTOS_SRC") == ""  # empty still means "skip"
    assert lib_value({**base, "KMK_BACKUP_PHOTOS_SRC": "/x"}, "KMK_BACKUP_PHOTOS_SRC") == "/x"


def test_a_symlinked_photo_folder_is_followed(setup, add_user, tmp_path):
    add_user()
    real = tmp_path / "real-photos"
    (real / "a").mkdir(parents=True)
    (real / "a" / "1.jpg").write_bytes(b"one")
    link = tmp_path / "photos-link"
    link.symlink_to(real, target_is_directory=True)
    r = run_at(setup, "2026-11-23 02:30:00", KMK_BACKUP_PHOTOS_SRC=str(link))
    assert r.returncode == 0, r.stderr
    assert status_of(setup)["message"] == "backup written (photos: 1 files)"
    (snap,) = photo_snapshots(setup)
    assert (snap / "a" / "1.jpg").read_bytes() == b"one" and not (snap / "a" / "1.jpg").is_symlink()
    # an unreadable file behind the link is still caught
    (real / "a" / "1.jpg").chmod(0o000)
    try:
        if os.access(real / "a" / "1.jpg", os.R_OK):
            pytest.skip("chmod does not block reads for this user")
        r = run_at(setup, "2026-11-24 02:30:00", KMK_BACKUP_PHOTOS_SRC=str(link), KMK_BACKUP_KEEP_DAILY="1")
    finally:
        (real / "a" / "1.jpg").chmod(0o644)
    assert r.returncode == 1 and status_of(setup)["result"] == "failed" and "photo" in status_of(setup)["message"]
    assert [p.name for p in photo_snapshots(setup)] == ["2026-11-23_023000"]
