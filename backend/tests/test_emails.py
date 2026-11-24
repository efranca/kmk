import json
import logging
import re

import httpx
import pytest

import app.emails.sender as sender
from app.emails.backends import send_email
from app.emails.templates import EmailMessage, build_link, render
from helpers import make_settings, sql

LINK = "https://app.kmk-entretien.ca/set-password#token=abc123"
EXPIRY = {
    ("invite", "fr-CA"): ("48", "heures"),
    ("invite", "en"): ("48", "hours"),
    ("invite", "pt-BR"): ("48", "horas"),
    ("reset", "fr-CA"): ("30", "minutes"),
    ("reset", "en"): ("30", "minutes"),
    ("reset", "pt-BR"): ("30", "minutos"),
}


@pytest.mark.parametrize("kind,locale", list(EXPIRY))
def test_templates_in_every_language(kind, locale):
    m = render(kind, locale, LINK, "maria@example.com")
    number, word = EXPIRY[(kind, locale)]
    for body in (m.text, m.html):
        assert LINK in body and "?token" not in body
        assert number in body and word in body
    assert m.to == "maria@example.com" and m.subject.strip()


def test_templates_differ_per_language_and_fall_back_to_french():
    assert render("reset", "en", LINK, "a@b.c").subject != render("reset", "fr-CA", LINK, "a@b.c").subject
    assert render("reset", "de", LINK, "a@b.c") == render("reset", "fr-CA", LINK, "a@b.c")


def test_build_link_uses_the_fragment():
    link = build_link(make_settings(public_base_url="https://x.example"), "tok")
    assert link == "https://x.example/set-password#token=tok"


def message():
    return EmailMessage(to="maria@example.com", subject="Subj", text="Hello " + LINK, html="<p>" + LINK + "</p>")


def test_log_backend_prints_the_message(caplog):
    with caplog.at_level(logging.INFO, logger="kmk.email"):
        assert send_email(message(), make_settings(email_backend="log")) is True
    assert "DEV EMAIL" in caplog.text and LINK in caplog.text


def resend_settings(**kw):
    return make_settings(email_backend="resend", resend_api_key="test-key", **kw)


def test_resend_request_shape():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["method"], seen["url"] = request.method, str(request.url)
        seen["auth"] = request.headers["authorization"]
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"id": "x"})

    ok = send_email(message(), resend_settings(email_from="KMK <no-reply@mail.example>"), transport=httpx.MockTransport(handler))
    assert ok is True
    assert (seen["method"], seen["url"]) == ("POST", "https://api.resend.com/emails")
    assert seen["auth"] == "Bearer test-key"
    assert seen["body"]["from"] == "KMK <no-reply@mail.example>"
    assert seen["body"]["to"] == ["maria@example.com"]
    assert seen["body"]["subject"] == "Subj" and LINK in seen["body"]["html"] and LINK in seen["body"]["text"]


@pytest.mark.parametrize("failure", ["500", "timeout"])
def test_resend_failures_return_false_without_leaking_the_key(failure, caplog):
    def handler(request):
        if failure == "timeout":
            raise httpx.ConnectTimeout("slow", request=request)
        return httpx.Response(500, text="boom test-key")

    with caplog.at_level(logging.DEBUG):
        assert send_email(message(), resend_settings(), transport=httpx.MockTransport(handler)) is False
    assert "test-key" not in caplog.text


def test_resend_without_key_returns_false():
    assert send_email(message(), make_settings(email_backend="resend", resend_api_key=None)) is False


def test_deliver_failure_writes_audit_without_address_or_key(owner_engine, app_engine, monkeypatch):
    monkeypatch.setattr(sender, "send_email", lambda *a, **k: False)
    sender.deliver(app_engine, resend_settings(), message(), None)
    rows = sql(owner_engine, "SELECT action, details::text FROM audit_log")
    assert [r[0] for r in rows] == ["email_failed"]
    assert "example.com" in rows[0][1] and "maria" not in rows[0][1] and "test-key" not in rows[0][1]


def test_deliver_never_raises(app_engine, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("provider exploded")

    monkeypatch.setattr(sender, "send_email", boom)
    sender.deliver(app_engine, make_settings(), message(), None)


def test_build_link_can_carry_the_language():
    s = make_settings(public_base_url="https://x.example")
    assert build_link(s, "tok", "pt-BR") == "https://x.example/set-password#token=tok&lang=pt-BR"
    assert build_link(s, "tok", None) == "https://x.example/set-password#token=tok"


@pytest.mark.parametrize("kind,locale", list(EXPIRY))
def test_messages_end_with_the_brand_line(kind, locale):
    m = render(kind, locale, LINK, "a@b.c")
    assert m.text.rstrip().endswith("KMK Entretien") and "Québec" not in m.text
    assert m.html.rstrip().endswith("</div>") and ">KMK Entretien<" in m.html


# ---- a person's name in the greeting ----

GREETINGS = {"fr-CA": ("Bonjour {n},", "Bonjour,"), "en": ("Hello {n},", "Hello,"), "pt-BR": ("Olá {n},", "Olá,")}


@pytest.mark.parametrize("kind,locale", list(EXPIRY))
def test_greeting_uses_the_name_when_there_is_one(kind, locale):
    named, generic = GREETINGS[locale]
    with_name = render(kind, locale, LINK, "a@b.c", name="Zoë D’Amour")
    plain = render(kind, locale, LINK, "a@b.c")
    assert with_name.text.startswith(named.format(n="Zoë D’Amour") + "\n")
    assert f"<p>{named.format(n='Zoë D’Amour')}</p>" in with_name.html
    assert plain.text.startswith(generic + "\n") and f"<p>{generic}</p>" in plain.html  # unchanged wording without a name
    assert with_name.subject == plain.subject  # a name never goes into the subject


def test_the_name_is_escaped_in_the_html_and_stays_out_of_every_header():
    m = render("invite", "en", LINK, "a@b.c", name="<b>x</b> O'Brien")
    assert "&lt;b&gt;x&lt;/b&gt;" in m.html and "<b>x" not in m.html
    assert "O&#x27;Brien" in m.html  # the apostrophe is escaped in markup, plain in the text part
    assert "O'Brien" in m.text
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"id": "x"})

    assert send_email(m, make_settings(email_backend="resend", resend_api_key="k"), transport=httpx.MockTransport(handler))
    body = seen["body"]
    for header_field in ("from", "to", "subject"):
        assert "O'Brien" not in json.dumps(body[header_field])  # only the text and html parts carry the name


LONG_LINK = "https://app.kmk-entretien.ca/set-password#token=jY9xtxvhyxGVUdBX-DM8y7FfAYIByFUMNxQtjZjITPI&lang=fr-CA"


@pytest.mark.parametrize("kind,locale", list(EXPIRY))
def test_html_hides_the_long_address_behind_link_text(kind, locale):
    m = render(kind, locale, LONG_LINK, "a@b.c")
    assert f'href="{LONG_LINK.replace("&", "&amp;")}"' in m.html  # the link still works
    visible = re.sub(r"<[^>]+>", " ", m.html)  # what a person reads in the HTML part
    assert "token=" not in visible and "set-password" not in visible
    assert LONG_LINK in m.text  # plain text has no links, so it keeps the address


@pytest.mark.parametrize("locale,label", [("fr-CA", "Choisir mon mot de passe"), ("en", "Choose my password"), ("pt-BR", "Escolher minha senha")])
def test_invite_link_text_per_language(locale, label):
    m = render("invite", locale, LONG_LINK, "a@b.c")
    assert f">{label}</a>" in m.html


def test_invite_names_the_site_as_a_https_link():
    m = render("invite", "fr-CA", LONG_LINK, "a@b.c")
    assert '<a href="https://app.kmk-entretien.ca"' in m.html and ">app.kmk-entretien.ca</a>" in m.html
    assert "Un compte a été créé pour vous sur app.kmk-entretien.ca." in m.text


def test_reset_link_text():
    assert ">Choisir un nouveau mot de passe</a>" in render("reset", "fr-CA", LONG_LINK, "a@b.c").html
