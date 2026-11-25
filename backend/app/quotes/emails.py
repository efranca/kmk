"""The two emails of the quotes feature: the reply an admin sends to a customer, and the notice to the team."""

from html import escape

from app.emails.templates import EmailMessage
from app.models import Quote

_SUBJECT = {
    "fr-CA": "Re: Votre soumission de nettoyage {ref}",
    "en-CA": "Re: Your cleaning quote {ref}",
    "pt-BR": "Re: Seu orçamento de limpeza {ref}",
}
_REF_LABEL = {"fr-CA": "Réf.", "en-CA": "Ref.", "pt-BR": "Ref."}
KIND_LABEL = {"airbnb": "Airbnb", "commercial": "Commercial", "post_construction": "Après-construction"}
SIGNATURE = "KMK Entretien Ménager"


def default_subject(quote: Quote) -> str:
    return _SUBJECT.get(quote.locale, _SUBJECT["fr-CA"]).format(ref=quote.reference)


def customer_reply(quote: Quote, subject: str, body: str, sender: str, reply_to: str | None) -> EmailMessage:
    ref = f"{_REF_LABEL.get(quote.locale, 'Réf.')} {quote.reference}"
    text = f"{body}\n\n{SIGNATURE}\n{ref}"
    html = f"<p>{escape(body).replace(chr(10), '<br>')}</p><p>{escape(SIGNATURE)}<br>{escape(ref)}</p>"
    return EmailMessage(to=quote.email, subject=subject, text=text, html=html, sender=sender, reply_to=reply_to)


def new_quote_notice(quote: Quote, to: str, base_url: str) -> EmailMessage:
    """For the team: the type, the name, the city and a link. Never the email, phone, free text or photos."""
    city = (quote.details or {}).get("city", "")
    link = f"{base_url}/quotes/{quote.id}"
    lines = [
        f"Nouvelle demande de soumission {quote.reference}.",
        f"Type : {KIND_LABEL.get(quote.kind, quote.kind)}",
        f"Nom : {quote.name}",
        f"Ville / quartier : {city}",
        f"À voir : {link}",
    ]
    html = "".join(f"<p>{escape(line)}</p>" for line in lines[:-1]) + f'<p><a href="{escape(link)}">{escape(link)}</a></p>'
    return EmailMessage(to=to, subject=f"Nouvelle demande de soumission {quote.reference}", text="\n".join(lines), html=html)
