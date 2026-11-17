class ApiError(Exception):
    """Raised anywhere in a request; the app turns it into `{"error": code}` with this status."""

    def __init__(self, status: int, code: str):
        self.status = status
        self.code = code
