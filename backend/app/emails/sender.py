import logging

from sqlalchemy import Engine
from sqlalchemy.orm import Session

from app.auth import audit
from app.config import Settings
from app.emails.backends import send_email
from app.emails.templates import EmailMessage

log = logging.getLogger("kmk.email")


def deliver(engine: Engine, settings: Settings, message: EmailMessage, target_user_id: int | None) -> None:
    """Send an email after the HTTP response; a failure is audited (no address, no key) and never raised."""
    try:
        if send_email(message, settings):
            return
        domain = message.to.rsplit("@", 1)[-1]
        with Session(engine) as db:
            audit.log(db, "email_failed", target_user_id=target_user_id, details={"to_domain": domain})
            db.commit()
    except Exception:
        log.exception("email delivery crashed")
