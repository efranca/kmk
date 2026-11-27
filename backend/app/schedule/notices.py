"""The email a person gets when they are added to an Agenda item."""

from datetime import date
from html import escape

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import preferences
from app.emails.templates import EmailMessage
from app.models import Event, User

_TEXT = {
    "fr-CA": ("Vous avez été ajouté(e) à un événement : {title}", "Date : {when}", "Voir la journée : {link}"),
    "en": ("You were added to an event: {title}", "When: {when}", "Open the day: {link}"),
    "pt-BR": ("Você foi adicionado(a) a um evento: {title}", "Quando: {when}", "Ver o dia: {link}"),
    "es": ("Te agregaron a un evento: {title}", "Cuándo: {when}", "Ver el día: {link}"),
}
_ALL_DAY = {"fr-CA": "toute la journée", "en": "all day", "pt-BR": "o dia todo", "es": "todo el día"}


def _message(event: Event, user: User, base_url: str) -> EmailMessage:
    head, when_line, link_line = _TEXT.get(user.locale, _TEXT["fr-CA"])
    day: date = event.start_date
    at = _ALL_DAY.get(user.locale, _ALL_DAY["fr-CA"]) if event.all_day or event.start_time is None else event.start_time.strftime("%H:%M")
    link = f"{base_url}/schedule?view=day&date={day.isoformat()}"
    values = dict(title=event.title, when=f"{day.isoformat()} {at}", link=link)
    lines = [head.format(**values), when_line.format(**values)]
    text = "\n".join([*lines, link_line.format(**values)])
    html = "".join(f"<p>{escape(line)}</p>" for line in lines) + f'<p><a href="{escape(link)}">{escape(link)}</a></p>'
    return EmailMessage(to=user.email, subject=head.format(**values), text=text, html=html)


def assignment_emails(db: Session, event: Event, added: set[int], actor: User, base_url: str) -> list[tuple[EmailMessage, int]]:
    """One message per active person who was added (not the one who made the change) and has not turned this off."""
    if not added:
        return []
    out = []
    for user in db.scalars(select(User).where(User.id.in_(added), User.status == "active", User.id != actor.id)):
        if preferences.normalize(user.preferences)["notify_assigned"]:
            out.append((_message(event, user, base_url), user.id))
    return out
