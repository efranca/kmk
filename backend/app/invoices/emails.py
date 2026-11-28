"""The email that carries an invoice: French, the PDF attached."""

from html import escape

from app.emails.templates import EmailMessage
from app.invoices import money
from app.models import Invoice


def invoice_email(invoice: Invoice, to: str, pdf: bytes, sender: str | None, reply_to: str | None) -> EmailMessage:
    ref = f"{invoice.number:03d}"
    paragraphs = [
        "Bonjour,",
        f"Veuillez trouver ci-joint la facture N° {ref} au montant de {money.format_fr(invoice.total)}.",
        "Pour toute question, répondez simplement à ce courriel.",
        "Nous vous remercions de votre confiance.\nKMK Entretien ménager",
    ]
    return EmailMessage(
        to=to,
        subject=f"Facture N° {ref} - KMK Entretien ménager",
        text="\n\n".join(paragraphs),
        html="".join(f"<p>{escape(p).replace(chr(10), '<br>')}</p>" for p in paragraphs),
        sender=sender,
        reply_to=reply_to,
        attachments=((f"Facture-{ref}.pdf", pdf),),
    )
