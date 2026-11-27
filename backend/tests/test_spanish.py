from app.emails.templates import render
from helpers import ORIGIN, login, sql
from test_admin import admin_client, create, user_id
from test_quote_arrival import send
from test_schedule_api import create as create_event, session, uid


def test_account_emails_exist_in_spanish():
    invite = render("invite", "es", "https://x/set-password#token=t&lang=es", "a@example.com", "Ana")
    assert invite.subject.startswith("Invitación") and invite.text.startswith("Hola Ana,") and "Elegir mi contraseña" in invite.html
    reset = render("reset", "es", "https://x/l", "a@example.com")
    assert reset.subject == "Restablecer tu contraseña" and reset.text.startswith("Hola,")


def test_a_person_can_choose_spanish_and_be_invited_in_it(make_client, add_user, owner_engine, outbox):
    c, h = admin_client(make_client, add_user, role="superadmin")
    r = create(c, h, locale="es")
    assert r.status_code == 201, r.text
    assert outbox[-1].subject.startswith("Invitación") and "lang=es" in outbox[-1].text
    assert sql(owner_engine, "SELECT locale FROM users WHERE username = 'maria'")[0][0] == "es"
    own = c.post("/api/auth/locale", json={"locale": "es"}, headers=h)
    assert own.status_code == 200 and own.json()["user"]["locale"] == "es"
    assert c.post("/api/auth/locale", json={"locale": "de"}, headers=h).status_code == 422


def test_assignment_and_quote_emails_speak_spanish(client, make_client, add_user, owner_engine, outbox):
    add_user("ana", "ana@example.com", locale="es")
    c, h = session(make_client, add_user, "boss", role="admin")
    create_event(c, h, title="Limpieza", start_date="2026-12-04", start_time="10:00", people=[uid(owner_engine, "ana")])
    assert outbox[-1].to == "ana@example.com" and outbox[-1].subject.startswith("Te agregaron a un evento") and "Cuándo:" in outbox[-1].text
    sql(owner_engine, "UPDATE users SET locale = 'es', settings = '{\"notify_quotes\": true}' WHERE username = 'boss'")
    outbox.clear()
    qid = send(client)
    mine = [m for m in outbox if m.to == "boss@example.com"]
    assert mine and mine[0].subject == f"Nueva solicitud de cotización D-{qid:04d}" and "Abrir:" in mine[0].text
