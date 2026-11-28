import base64
import logging

import httpx

from app.config import Settings
from app.emails.templates import EmailMessage

log = logging.getLogger("kmk.email")
RESEND_URL = "https://api.resend.com/emails"


def send_email(message: EmailMessage, settings: Settings, transport: httpx.BaseTransport | None = None) -> bool:
    if settings.email_backend == "resend":
        return _send_resend(message, settings, transport)
    # Development backend: the whole message, link included, goes to the log. Never use it with real users.
    files = ", ".join(f"{name} ({len(data)} bytes)" for name, data in message.attachments) or "none"
    log.info("DEV EMAIL to=%s from=%s reply_to=%s subject=%s attachments=%s\n%s", message.to, message.sender or settings.email_from, message.reply_to, message.subject, files, message.text)
    return True


def _send_resend(message: EmailMessage, settings: Settings, transport: httpx.BaseTransport | None) -> bool:
    if not settings.resend_api_key:
        log.warning("resend backend selected but RESEND_API_KEY is not set")
        return False
    payload = {
        "from": message.sender or settings.email_from,
        "to": [message.to],
        "subject": message.subject,
        "html": message.html,
        "text": message.text,
    }
    if message.reply_to:
        payload["reply_to"] = [message.reply_to]
    if message.attachments:
        payload["attachments"] = [{"filename": name, "content": base64.b64encode(data).decode()} for name, data in message.attachments]
    try:
        with httpx.Client(transport=transport, timeout=10.0) as client:
            response = client.post(RESEND_URL, headers={"Authorization": f"Bearer {settings.resend_api_key}"}, json=payload)
    except httpx.HTTPError as exc:
        log.warning("email send failed: %s", type(exc).__name__)
        return False
    if not response.is_success:
        log.warning("email send failed: HTTP %s", response.status_code)
        return False
    return True
