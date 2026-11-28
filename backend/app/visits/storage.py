"""The photo files of visits: `root/<id[:2]>/<id>`, where the id is 32 random hex characters we generate.

No path is ever built from anything a user sent: `file_id` is checked against `^[0-9a-f]{32}$` first.
"""

import os
import re
import secrets
import shutil
import threading
from pathlib import Path

_ID = re.compile(r"[0-9a-f]{32}")


def _check(file_id: str) -> str:
    if not isinstance(file_id, str) or _ID.fullmatch(file_id) is None:
        raise ValueError("bad file id")
    return file_id


def _path(root: Path, file_id: str) -> Path:
    _check(file_id)
    return Path(root) / file_id[:2] / file_id


_UMASK_LOCK = threading.Lock()


def _umask() -> int | None:
    """The process umask, read without changing it (Linux); None when it cannot be read."""
    try:
        for line in Path("/proc/self/status").read_text().splitlines():
            if line.startswith("Umask:"):
                return int(line.split()[1], 8)
    except (OSError, ValueError, IndexError):
        pass
    return None


def _make_shard(folder: Path) -> None:
    """Create a shard folder with mode 750, never changing the mode of a folder afterwards (ruling R14).

    The group and the setgid bit come from the root folder (prepared `chmod 2750` with the host user's group): the
    kernel gives them to a new folder. A chmod would undo that: inside the container the API is not in that group and
    has no CAP_FSETID, so the kernel clears the setgid bit on any chmod of the folder. So the mode is given at creation
    only; a umask that would take the group's read/search bits away is narrowed for that one mkdir (rare: the
    container's umask is 022)."""
    if folder.is_dir():
        return
    folder.parent.mkdir(parents=True, exist_ok=True)  # the root itself, if missing (tests; the deployment prepares it)
    mask = _umask()
    if mask is not None and mask & 0o750 == 0:
        folder.mkdir(mode=0o750, exist_ok=True)
        return
    with _UMASK_LOCK:
        old = os.umask(0o027)
        try:
            folder.mkdir(mode=0o750, exist_ok=True)
        finally:
            os.umask(old)


def save(root: Path, data: bytes) -> str:
    """Write the bytes under a new random id (temp name first, then an atomic rename; file mode 640, a new shard folder
    750) and return the id. Folder modes are never changed (see `_make_shard`); only the new file's mode is set."""
    file_id = secrets.token_hex(16)
    path = _path(root, file_id)
    _make_shard(path.parent)
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
