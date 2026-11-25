"""What happens when a request arrives: the shared task, the Agenda deadline, the notification email and the push."""

import logging

from sqlalchemy import Engine
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import Quote

log = logging.getLogger("kmk.quotes")


def on_submitted(db: Session, quote: Quote) -> None:
    """Runs in the submitting transaction (task and Agenda item). Filled in by the arrival task."""


def notify(engine: Engine, settings: Settings, quote_id: int) -> None:
    """Runs after the response (email and push); never raises. Filled in by the arrival task."""
