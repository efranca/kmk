import json
import logging

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
