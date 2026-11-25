"""What happens when a request arrives: the shared task, the Agenda deadline, the notification email and the push."""

import logging

from sqlalchemy import Engine, select
from sqlalchemy.orm import Session

from app import system_settings
from app.config import Settings, get_settings
from app.emails import sender
from app.push import service as push
from app.models import Event, EventPerson, EventReminder, Quote, Task, TaskCategory, TaskPerson, User
from app.quotes import emails
from app.schedule.service import COMPANY_TZ

log = logging.getLogger("kmk.quotes")
EVENT_MINUTES = 30
REMINDER = (2, "hours")
ICON = "📋"
PRIVILEGED = ("admin", "superadmin")


def _label(quote: Quote) -> str:
    """Reference, type and city: all a task or Agenda item says (every signed-in user can read those lists)."""
    city = (quote.details or {}).get("city", "")
    return f"{quote.reference} · {emails.KIND_LABEL.get(quote.kind, quote.kind)} · {city}"


def on_submitted(db: Session, quote: Quote) -> None:
    """In the submitting transaction: one task and one Agenda item, for every active admin and the super admin."""
    link = f"{get_settings().public_base_url}/quotes/{quote.id}"
    people = list(db.scalars(select(User.id).where(User.role.in_(PRIVILEGED), User.status == "active")))
    due = quote.deadline_at.astimezone(COMPANY_TZ)
    category = db.scalar(select(TaskCategory.id).where(TaskCategory.name.ilike("quotes")).limit(1))
    task = Task(title=f"Quote {_label(quote)}", description=link, icon=ICON, category_id=category, due_date=due.date(), created_by=None, updated_by=None)
    event = Event(
        title=f"Quote deadline {_label(quote)}", notes=link, icon=ICON, all_day=False, start_date=due.date(),
        start_time=due.time().replace(second=0, microsecond=0), duration_minutes=EVENT_MINUTES, created_by=None, updated_by=None,
    )
    db.add_all([task, event])
    db.flush()
    db.add_all([TaskPerson(task_id=task.id, user_id=u) for u in people])
    db.add_all([EventPerson(event_id=event.id, user_id=u) for u in people])
    db.add(EventReminder(event_id=event.id, amount=REMINDER[0], unit=REMINDER[1]))
    quote.task_id, quote.event_id = task.id, event.id


def notify(engine: Engine, settings: Settings, quote_id: int) -> None:
    """After the response: the notification email and the push. Never raises (the request is already saved)."""
    try:
        with Session(engine) as db:
            quote = db.get(Quote, quote_id)
            if quote is None:
                return
            to = system_settings.get(db, "quote_notify_email")
            message = emails.new_quote_notice(quote, to, settings.public_base_url) if to else None
            payload = {"title": "Nouvelle demande de soumission", "body": _label(quote), "url": f"/quotes/{quote.id}"}
        if message is not None:
            sender.deliver(engine, settings, message, None)
        _push(engine, settings, payload)
    except Exception:
        log.exception("quote notification failed")


def _push(engine: Engine, settings: Settings, payload: dict) -> None:
    push.send_to_admins(engine, settings, payload)  # never raises
