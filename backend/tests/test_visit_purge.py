"""Retention: photos of visits older than 6 months are deleted (the row stays), plus files no row knows (spec 14, 15)."""

import os
import time
from datetime import date, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import NullPool

import app.cli as cli
from helpers import ORIGIN, login, sql
from test_schedule_api import create

from app.config import get_settings
from app.visits import purge, storage

TODAY = date(2026, 11, 28)
OLD = TODAY - timedelta(days=184)
EDGE = TODAY - timedelta(days=183)  # exactly 183 days ago is not yet purged


def add_visit(engine, visit_date, event_id=None):
    return sql(
        engine,
        "INSERT INTO visits (event_id, occurrence_date, visit_date, property_name) VALUES (:e, :d, :d, 'Maison') RETURNING id",
        d=visit_date,
        e=event_id,
    )[0][0]


def add_photo(engine, root, visit_id, deleted=False, purged=False, keep_file=True):
    file_id = storage.save(root, b"photo-bytes")
    if not keep_file:
        storage.delete(root, file_id)
    pid = sql(
        engine,
        "INSERT INTO visit_photos (visit_id, file_id, room_name, content_type, size, sha256, deleted_at, purged_at) "
        "VALUES (:v, :f, 'Kitchen', 'image/webp', 11, 'x', "
        "CASE WHEN :d THEN now() END, CASE WHEN :p THEN now() END) RETURNING id",
        v=visit_id,
        f=file_id,
        d=deleted,
        p=purged,
    )[0][0]
    return pid, file_id


def run(url, root, today=TODAY):
    engine = create_engine(url, poolclass=NullPool)
    try:
        with Session(engine) as db:
            return purge.run(db, root, today)
    finally:
        engine.dispose()


@pytest.fixture
def app_url():
    return os.environ["TEST_APP_DATABASE_URL"]


def age(path, seconds):
    t = time.time() - seconds
    os.utime(path, (t, t))


def shard_path(root, file_id):
    return root / file_id[:2] / file_id


def test_old_photos_are_purged_and_the_row_stays(make_client, add_user, owner_engine, tmp_path, app_url):
    add_user("boss", "boss@example.com", role="admin")
    c = make_client(visit_photos_dir=str(tmp_path))
    h = {**ORIGIN, "X-CSRF-Token": login(c, "boss").json()["csrf_token"]}
    eid = create(c, h, title="Menage", start_date=str(OLD)).json()["event"]["id"]
    v = add_visit(owner_engine, OLD, eid)
    live, _ = add_photo(owner_engine, tmp_path, v)
    add_photo(owner_engine, tmp_path, v, deleted=True)
    add_photo(owner_engine, tmp_path, v, keep_file=False)
    assert c.get(f"/api/visit-photos/{live}").status_code == 200
    assert run(app_url, tmp_path) == {"purged": 3, "orphans": 0}
    assert storage.all_ids(tmp_path) == set()
    rows = sql(owner_engine, "SELECT purged_at IS NOT NULL, deleted_at IS NOT NULL FROM visit_photos ORDER BY id")
    assert [tuple(r) for r in rows] == [(True, False), (True, True), (True, False)]
    assert c.get(f"/api/visit-photos/{live}").status_code == 404
    assert run(app_url, tmp_path) == {"purged": 0, "orphans": 0}  # safe to run twice


def test_a_photo_removed_by_a_correction_leaves_with_the_purge(add_user, make_client, owner_engine, tmp_path, app_url):
    """Ruling R16: a correction keeps the removed photo's file; the purge deletes it after the retention, the row stays."""
    add_user("boss", "boss@example.com", role="admin")
    c = make_client(visit_photos_dir=str(tmp_path))
    h = {**ORIGIN, "X-CSRF-Token": login(c, "boss").json()["csrf_token"]}
    eid = create(c, h, title="Menage", start_date=str(OLD)).json()["event"]["id"]
    v = add_visit(owner_engine, OLD, eid)
    removed, file_id = add_photo(owner_engine, tmp_path, v, deleted=True)
    assert c.get(f"/api/visit-photos/{removed}").status_code == 200  # kept, and admins can open it
    assert run(app_url, tmp_path) == {"purged": 1, "orphans": 0}
    assert file_id not in storage.all_ids(tmp_path)
    rows = sql(owner_engine, "SELECT deleted_at IS NOT NULL, purged_at IS NOT NULL FROM visit_photos WHERE id = :p", p=removed)
    assert [tuple(r) for r in rows] == [(True, True)]
    assert c.get(f"/api/visit-photos/{removed}").status_code == 404


def test_recent_photos_stay(owner_engine, tmp_path, app_url):
    v = add_visit(owner_engine, EDGE)
    _, f = add_photo(owner_engine, tmp_path, v)
    assert run(app_url, tmp_path) == {"purged": 0, "orphans": 0}
    assert storage.all_ids(tmp_path) == {f}
    assert sql(owner_engine, "SELECT count(*) FROM visit_photos WHERE purged_at IS NULL")[0][0] == 1


def test_already_purged_rows_are_left_alone(owner_engine, tmp_path, app_url):
    v = add_visit(owner_engine, OLD)
    add_photo(owner_engine, tmp_path, v, purged=True, keep_file=False)
    assert run(app_url, tmp_path)["purged"] == 0


def test_a_missing_file_does_not_stop_the_purge(owner_engine, tmp_path, app_url):
    v = add_visit(owner_engine, OLD)
    add_photo(owner_engine, tmp_path, v, keep_file=False)
    assert run(app_url, tmp_path)["purged"] == 1


def test_works_in_batches(owner_engine, tmp_path, app_url, monkeypatch):
    monkeypatch.setattr(purge, "BATCH", 2)
    v = add_visit(owner_engine, OLD)
    for _ in range(5):
        add_photo(owner_engine, tmp_path, v)
    assert run(app_url, tmp_path)["purged"] == 5
    assert storage.all_ids(tmp_path) == set()


def test_orphan_files_are_removed_but_not_fresh_ones(owner_engine, tmp_path, app_url):
    v = add_visit(owner_engine, TODAY)
    _, known = add_photo(owner_engine, tmp_path, v)
    age(shard_path(tmp_path, known), 7200)  # old but it has a row: stays
    old = storage.save(tmp_path, b"o")
    fresh = storage.save(tmp_path, b"f")
    age(shard_path(tmp_path, old), 7200)
    stale_tmp = tmp_path / "cc" / ("c" * 32 + ".tmp")
    fresh_tmp = tmp_path / "dd" / ("d" * 32 + ".tmp")
    stranger = tmp_path / "ab" / "notes.txt"
    for p in (stale_tmp, fresh_tmp, stranger):
        p.parent.mkdir(exist_ok=True)
        p.write_bytes(b"z")
    age(stale_tmp, 7200)
    age(stranger, 7200)
    assert run(app_url, tmp_path) == {"purged": 0, "orphans": 2}
    assert storage.all_ids(tmp_path) == {known, fresh}
    assert not stale_tmp.exists() and fresh_tmp.exists() and stranger.exists()


def test_never_follows_symlinks_or_leaves_the_folder(owner_engine, tmp_path, app_url):
    root = tmp_path / "photos"
    root.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    target = outside / ("e" * 32)
    target.write_bytes(b"keep")
    age(target, 7200)
    (root / "ee").mkdir()
    link = root / "ee" / ("e" * 32)
    link.symlink_to(target)
    (root / "ff").symlink_to(outside, target_is_directory=True)  # a shard that is a link
    run(app_url, root)
    assert target.exists()


def test_missing_folder_is_fine(owner_engine, tmp_path, app_url):
    assert run(app_url, tmp_path / "nope") == {"purged": 0, "orphans": 0}


def test_cli_runs_the_purge(owner_engine, tmp_path, monkeypatch, capsys):
    v = add_visit(owner_engine, date(2000, 1, 1))
    add_photo(owner_engine, tmp_path, v)
    monkeypatch.setenv("VISIT_PHOTOS_DIR", str(tmp_path))
    get_settings.cache_clear()
    try:
        assert cli.main(["purge-visit-photos"]) == 0
        assert capsys.readouterr().out.strip() == "purged=1 orphans=0"
        monkeypatch.setenv("VISIT_PHOTOS_DIR", str(tmp_path / "missing"))
        get_settings.cache_clear()
        assert cli.main(["purge-visit-photos"]) == 0
        assert capsys.readouterr().out.strip() == "purged=0 orphans=0"
    finally:
        get_settings.cache_clear()
