class ApiError(Exception):
    """Raised anywhere in a request; the app turns it into `{"error": code}` with this status (plus the keys of `extra`,
    for the few answers that must say more, such as the rooms that still miss a photo)."""

    def __init__(self, status: int, code: str, extra: dict | None = None):
        self.status = status
        self.code = code
        self.extra = extra
