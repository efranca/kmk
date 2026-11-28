"""Retention of visit photos (spec sections 14 and 15).

Photos of visits older than PHOTO_RETENTION_DAYS lose their file; the row stays (so the count and the history stay).
Files no row knows about (and stale temp files) are swept too, but only when older than an hour, because an upload
writes its file before its row exists. Work is done in small committed batches, so no long transaction is held, and a
crash at any point leaves only a file the next run deletes again.
"""

import os
import re
import time
from datetime import date, timedelta
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.visits import storage
from app.visits.limits import PHOTO_RETENTION_DAYS

BATCH = 200  # rows per commit
GRACE_SECONDS = 3600  # a file younger than this is never an orphan

_ID = re.compile(r"[0-9a-f]{32}")
_TMP = re.compile(r"[0-9a-f]{32}\.tmp")


def _purge_old(db: Session, root: Path, today: date) -> int:
    cutoff = today - timedelta(days=PHOTO_RETENTION_DAYS)
    purged = 0
    last = 0
    while True:
        rows = db.execute(
            text(
                "SELECT p.id, p.file_id FROM visit_photos p JOIN visits v ON v.id = p.visit_id "
                "WHERE p.purged_at IS NULL AND v.visit_date < :cutoff AND p.id > :last ORDER BY p.id LIMIT :n"
            ),
            {"cutoff": cutoff, "last": last, "n": BATCH},
        ).all()
        db.rollback()  # end the read transaction: nothing is held while files are deleted
        if not rows:
            return purged
        last = rows[-1][0]
        done = []
        for photo_id, file_id in rows:
            try:
                storage.delete(root, file_id)  # file first; a missing file is fine
            except (ValueError, OSError):
                continue  # never mark a row purged while its file may still exist
            done.append(photo_id)
        if done:
            result = db.execute(
                text("UPDATE visit_photos SET purged_at = now() WHERE id = ANY(:ids) AND purged_at IS NULL"),
                {"ids": done},
            )
            purged += result.rowcount
        db.commit()


def _sweep(db: Session, root: Path) -> int:
    base = Path(root)
    if not base.is_dir():
        return 0
    cutoff = time.time() - GRACE_SECONDS
    removed = 0
    try:
        shards = [e for e in os.scandir(base) if len(e.name) == 2 and e.is_dir(follow_symlinks=False)]
    except OSError:
        return 0
    for shard in shards:
        candidates: dict[str, Path] = {}
        try:
            entries = list(os.scandir(shard.path))
        except OSError:
            continue
        for entry in entries:
            try:
                if not entry.is_file(follow_symlinks=False) or entry.stat(follow_symlinks=False).st_mtime >= cutoff:
                    continue
            except OSError:
                continue
            name = entry.name
            if _TMP.fullmatch(name) and name[:2] == shard.name:
                try:
                    os.unlink(entry.path)
                    removed += 1
                except OSError:
                    pass
            elif _ID.fullmatch(name) and name[:2] == shard.name:
                candidates[name] = Path(entry.path)
        if not candidates:
            continue
        known = set(
            db.execute(text("SELECT file_id FROM visit_photos WHERE file_id = ANY(:ids)"), {"ids": list(candidates)}).scalars()
        )
        db.rollback()
        for file_id, path in candidates.items():
            if file_id in known:
                continue
            try:
                os.unlink(path)
                removed += 1
            except OSError:
                pass
    return removed


def run(db: Session, root: Path, today: date) -> dict:
    """`root` must be an absolute path: an empty setting would be `Path("")`, the working directory, and the sweep
    would then delete files there (`ValueError` instead)."""
    if not str(root) or not Path(root).is_absolute():
        raise ValueError("the visit photo folder must be an absolute path")
    purged = _purge_old(db, root, today)
    orphans = _sweep(db, root)
    return {"purged": purged, "orphans": orphans}
