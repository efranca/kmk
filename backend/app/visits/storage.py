"""The photo files of visits: `root/<id[:2]>/<id>`, where the id is 32 random hex characters we generate.

No path is ever built from anything a user sent: `file_id` is checked against `^[0-9a-f]{32}$` first.
"""

import os
import re
import secrets
import shutil
from pathlib import Path

_ID = re.compile(r"[0-9a-f]{32}")


def _check(file_id: str) -> str:
    if not isinstance(file_id, str) or _ID.fullmatch(file_id) is None:
        raise ValueError("bad file id")
    return file_id


def _path(root: Path, file_id: str) -> Path:
    _check(file_id)
    return Path(root) / file_id[:2] / file_id


def save(root: Path, data: bytes) -> str:
    """Write the bytes under a new random id (temp name first, then an atomic rename; file mode 640, shard folder 750) and return the id."""
    file_id = secrets.token_hex(16)
    path = _path(root, file_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    # Modes are set explicitly (the umask must not change them). The group is whatever the setgid root folder gives:
    # the host user's backup reads the files through it. Keep a setgid bit the folder inherited.
    os.chmod(path.parent, 0o750 | (path.parent.stat().st_mode & 0o2000))
    temp = path.with_name(file_id + ".tmp")
    try:
        fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o640)
        with os.fdopen(fd, "wb") as handle:
            os.fchmod(handle.fileno(), 0o640)
            handle.write(data)
        os.replace(temp, path)
    except BaseException:
        temp.unlink(missing_ok=True)
        raise
    return file_id


def open_bytes(root: Path, file_id: str) -> bytes:
    return _path(root, file_id).read_bytes()


def delete(root: Path, file_id: str) -> None:
    _path(root, file_id).unlink(missing_ok=True)


def free_bytes(root: Path) -> int:
    Path(root).mkdir(parents=True, exist_ok=True)
    return shutil.disk_usage(root).free


def all_ids(root: Path) -> set[str]:
    """Every stored file id (temporary and foreign files are ignored)."""
    base = Path(root)
    if not base.is_dir():
        return set()
    return {p.name for p in base.glob("??/*") if _ID.fullmatch(p.name) and p.parent.name == p.name[:2]}
