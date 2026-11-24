"""What build is running: the package's major.minor, the commit count as the third number, the commit and the build time.

The last three are baked into the image from build arguments (see the Dockerfile and deploy/docker-compose.yml);
a build without them reports an empty commit and no build time.
"""

import os
from importlib.metadata import PackageNotFoundError, version as package_version

from fastapi import APIRouter, Depends

from app.auth.guard import guard

router = APIRouter()


def _package_version() -> str:
    try:
        return package_version("kmk-api")
    except PackageNotFoundError:
        return "0.0.0"


def compute_version(package: str, commit_count: str | None) -> str:
    """`major.minor.<commit count>`; the plain package version when the count is missing or not a positive integer."""
    if not commit_count or not commit_count.isascii() or not commit_count.isdigit() or int(commit_count) < 1:
        return package
    major, _, rest = package.partition(".")
    minor = rest.partition(".")[0] or "0"
    return f"{major}.{minor}.{int(commit_count)}"


def build_info() -> dict:
    return {
        "version": compute_version(_package_version(), os.environ.get("APP_COMMIT_COUNT")),
        "commit": os.environ.get("APP_COMMIT", ""),
        "built_at": os.environ.get("APP_BUILT_AT") or None,
    }


@router.get("/api/version", dependencies=[Depends(guard(csrf=False))])
def get_version() -> dict:
    return build_info()
