import pytest

from app.models import Quote
from app.quotes import emails


def quote(locale="fr-CA", **kw):
    q = Quote(id=42, kind="airbnb", name="Maria Silva", email="maria@example.com", phone="418-555-0100", locale=locale,
              details={"city": "Québec"}, message="Mon texte privé", ip="1.2.3.4", ip_key="1.2.3.4", token_hash="x")
    for k, v in kw.items():
        setattr(q, k, v)
    return q


@pytest.mark.parametrize(
    "locale,subject",
    [
        ("fr-CA", "Re: Votre soumission de nettoyage D-0042"),
        ("en-CA", "Re: Your cleaning quote D-0042"),
        ("pt-BR", "Re: Seu orçamento de limpeza D-0042"),
    ],
)
def test_default_subject_per_locale(locale, subject):
    assert emails.default_subject(quote(locale)) == subject


def test_customer_reply_goes_to_the_customer_with_sender_and_reply_to():
    msg = emails.customer_reply(quote(), "Re: X", "Bonjour Maria", "KMK <devis@mail.example>", "kmk@gmail.com")
    assert (msg.to, msg.subject, msg.sender, msg.reply_to) == ("maria@example.com", "Re: X", "KMK <devis@mail.example>", "kmk@gmail.com")
    assert msg.text.startswith("Bonjour Maria") and "KMK Entretien Ménager" in msg.text and "Réf. D-0042" in msg.text


def test_customer_reply_escapes_html_and_keeps_lines():
    msg = emails.customer_reply(quote("en-CA"), "S", "a<b>\nc", "KMK <d@m.example>", None)
    assert "a&lt;b&gt;<br>c" in msg.html and "<b>" not in msg.html and "Ref. D-0042" in msg.text


def test_new_quote_notice_has_no_contact_details():
    msg = emails.new_quote_notice(quote(), "team@example.com", "https://app.example")
    assert msg.to == "team@example.com" and msg.subject == "Nouvelle demande de soumission D-0042"
    everything = msg.subject + msg.text + msg.html
    for secret in ("maria@example.com", "418-555-0100", "Mon texte privé"):
        assert secret not in everything
    assert "https://app.example/quotes/42" in msg.text and "Québec" in msg.text and "Airbnb" in msg.text
