import pytest

from test_quotes_public_api import HEIC, JPEG, photo, start, submit
from helpers import ORIGIN, login, sql

FROM = "KMK Devis <devis@mail.kmk-entretien.com>"


def session(make_client, add_user, username, role):
    add_user(username, f"{username}@example.com", role=role)
    c = make_client()
    token = login(c, username).json()["csrf_token"]
    return c, {**ORIGIN, "X-CSRF-Token": token}


@pytest.fixture
def ana(make_client, add_user):
    return session(make_client, add_user, "ana", "admin")


@pytest.fixture
def configured(owner_engine):
    sql(owner_engine, "INSERT INTO app_settings (key, value) VALUES ('quote_from', :f), ('quote_reply_to', 'kmk@gmail.com')", f=FROM)


def new_quote(c, **kw):
    a = start(c, **kw).json()
    assert submit(c, a["id"], a["token"]).status_code == 200
    return a


def reply(c, h, qid, body="Voici notre prix.", subject="Re: Votre soumission", **kw):
    return c.post(f"/api/quotes/{qid}/messages", json={"direction": "out", "subject": subject, "body": body, **kw}, headers=h)


def paste(c, h, qid, body="Merci, c'est parfait.", **kw):
    return c.post(f"/api/quotes/{qid}/messages", json={"direction": "in", "body": body, **kw}, headers=h)


def status_of(owner_engine, qid):
    return sql(owner_engine, "SELECT status FROM quotes WHERE id = :i", i=qid)[0][0]


def test_a_user_gets_403_everywhere(make_client, add_user, ana):
    qid = new_quote(ana[0])["id"]
    tom, th = session(make_client, add_user, "tom", "user")
    for method, url, body in [
        ("GET", "/api/quotes", None), ("GET", f"/api/quotes/{qid}", None), ("PATCH", f"/api/quotes/{qid}", {"status": "won"}),
        ("POST", f"/api/quotes/{qid}/messages", {"direction": "in", "body": "x"}), ("POST", f"/api/quotes/{qid}/messages/1/retry", None),
        ("DELETE", f"/api/quotes/{qid}", None), ("GET", f"/api/quotes/{qid}/photos/1", None),
    ]:
        r = tom.request(method, url, json=body, headers=th)
        assert r.status_code == 403, (method, url, r.status_code)


def test_admin_lists_and_reads(ana):
    c, _ = ana
    a = new_quote(c, message="Plusieurs détails")
    assert photo(c, a["id"], a["token"]).status_code == 404  # already sent: only drafts take photos
    listing = c.get("/api/quotes").json()
    assert listing["counts"] == {"new": 1, "customer_replied": 0}
    (row,) = listing["quotes"]
    assert row["reference"] == f"D-{a['id']:04d}" and row["status"] == "new" and row["name"] == "Maria Silva"
    assert row["kind"] == "airbnb" and row["city"] == "Québec" and row["messages"] == 0 and row["overdue"] is False
    assert row["email"] == "maria@example.com" and row["phone"] == "418-555-0100"  # the list is searched by them
    detail = c.get(f"/api/quotes/{a['id']}").json()["quote"]
    assert detail["email"] == "maria@example.com" and detail["phone"] == "418-555-0100" and detail["message"] == "Plusieurs détails"
    assert detail["details"]["address"] == "123 rue Saint-Jean, app. 4" and detail["details"]["city"] == "Québec"
    assert detail["details"]["bedrooms"] == 2 and detail["conversation"] == [] and detail["photos"] == []
    assert detail["default_subject"] == f"Re: Votre soumission de nettoyage D-{a['id']:04d}"
    assert detail["ip"] == "203.0.113.7" and detail["locale"] == "fr-CA"
    assert detail["task_id"] and detail["event_id"]


def test_status_tabs_filter_the_list(ana):
    c, h = ana
    a, b = new_quote(c)["id"], new_quote(c)["id"]
    c.patch(f"/api/quotes/{b}", json={"status": "won"}, headers=h)
    assert [q["id"] for q in c.get("/api/quotes", params={"status": "won"}).json()["quotes"]] == [b]
    assert [q["id"] for q in c.get("/api/quotes", params={"status": "new"}).json()["quotes"]] == [a]
    assert {q["id"] for q in c.get("/api/quotes", params={"status": "all"}).json()["quotes"]} == {a, b}
    assert c.get("/api/quotes", params={"status": "bogus"}).status_code == 422


def test_drafts_are_hidden(ana):
    c, _ = ana
    draft = start(c).json()
    assert c.get("/api/quotes").json()["quotes"] == []
    assert c.get(f"/api/quotes/{draft['id']}").status_code == 404


def test_overdue_only_while_new(ana, owner_engine):
    c, h = ana
    qid = new_quote(c)["id"]
    sql(owner_engine, "UPDATE quotes SET deadline_at = now() - interval '1 hour'")
    assert c.get("/api/quotes").json()["quotes"][0]["overdue"] is True
    c.patch(f"/api/quotes/{qid}", json={"status": "replied"}, headers=h)
    assert c.get("/api/quotes").json()["quotes"][0]["overdue"] is False


def test_first_reply_emails_completes_the_task_and_removes_the_event(ana, owner_engine, configured, outbox):
    c, h = ana
    qid = new_quote(c)["id"]
    r = reply(c, h, qid)
    assert r.status_code == 201, r.text
    (m,) = outbox
    assert (m.to, m.sender, m.reply_to, m.subject) == ("maria@example.com", FROM, "kmk@gmail.com", "Re: Votre soumission")
    assert "Voici notre prix." in m.text
    assert r.json()["quote"]["status"] == "replied" and r.json()["message"]["delivery"] == "sent"
    ana_id = sql(owner_engine, "SELECT id FROM users WHERE username = 'ana'")[0][0]
    status, done_at, done_by = sql(owner_engine, "SELECT status, completed_at, completed_by FROM tasks")[0]
    assert status == "completed" and done_at is not None and done_by == ana_id
    assert sql(owner_engine, "SELECT count(*) FROM events")[0][0] == 0
    assert sql(owner_engine, "SELECT event_id, first_reply_at IS NOT NULL FROM quotes")[0] == (None, True)


def test_pasted_reply_then_our_reply_flow(ana, owner_engine, configured, outbox):
    c, h = ana
    qid = new_quote(c)["id"]
    reply(c, h, qid)
    assert paste(c, h, qid).json()["quote"]["status"] == "customer_replied"
    assert c.get("/api/quotes").json()["counts"] == {"new": 0, "customer_replied": 1}
    assert reply(c, h, qid, body="Parfait, on confirme.").json()["quote"]["status"] == "replied"
    assert sql(owner_engine, "SELECT count(*) FROM tasks WHERE status = 'completed'")[0][0] == 1  # nothing new was created
    conversation = c.get(f"/api/quotes/{qid}").json()["quote"]["conversation"]
    assert [m["direction"] for m in conversation] == ["out", "in", "out"] and conversation[0]["author"]["name"] == "ana"


def test_a_pasted_reply_before_any_reply_leaves_the_task_open(ana, owner_engine):
    c, h = ana
    qid = new_quote(c)["id"]
    assert paste(c, h, qid).json()["quote"]["status"] == "customer_replied"
    assert sql(owner_engine, "SELECT status FROM tasks")[0][0] == "pending"


def test_won_and_lost_are_not_changed_by_messages(ana, configured, outbox, owner_engine):
    c, h = ana
    qid = new_quote(c)["id"]
    c.patch(f"/api/quotes/{qid}", json={"status": "won"}, headers=h)
    reply(c, h, qid)
    paste(c, h, qid)
    assert status_of(owner_engine, qid) == "won"


def test_a_reply_without_a_configured_sender_is_refused_and_stores_nothing(ana, owner_engine, outbox):
    c, h = ana
    qid = new_quote(c)["id"]
    r = reply(c, h, qid)
    assert r.status_code == 409 and r.json() == {"error": "sender_not_configured"}
    assert sql(owner_engine, "SELECT count(*) FROM quote_messages")[0][0] == 0 and outbox == []


def test_a_failed_send_is_stored_and_changes_nothing_until_a_retry_succeeds(ana, owner_engine, configured, monkeypatch):
    import app.emails.sender as sender

    c, h = ana
    qid = new_quote(c)["id"]
    monkeypatch.setattr(sender, "send_email", lambda message, settings, *a, **k: False)
    r = reply(c, h, qid)
    assert r.status_code == 201 and r.json()["message"]["delivery"] == "failed"
    assert status_of(owner_engine, qid) == "new" and sql(owner_engine, "SELECT status FROM tasks")[0][0] == "pending"
    mid = r.json()["message"]["id"]
    sent = []
    monkeypatch.setattr(sender, "send_email", lambda message, settings, *a, **k: sent.append(message) or True)
    retried = c.post(f"/api/quotes/{qid}/messages/{mid}/retry", headers=h)
    assert retried.status_code == 200 and retried.json()["message"]["delivery"] == "sent" and len(sent) == 1
    assert status_of(owner_engine, qid) == "replied" and sql(owner_engine, "SELECT status FROM tasks")[0][0] == "completed"
    assert c.post(f"/api/quotes/{qid}/messages/{mid}/retry", headers=h).status_code == 409


def test_a_provider_that_raises_counts_as_failed(ana, configured, monkeypatch):
    import app.emails.sender as sender

    c, h = ana
    qid = new_quote(c)["id"]

    def boom(*a, **k):
        raise RuntimeError("down")

    monkeypatch.setattr(sender, "send_email", boom)
    assert reply(c, h, qid).json()["message"]["delivery"] == "failed"


def test_retry_of_a_pasted_message_is_refused(ana):
    c, h = ana
    qid = new_quote(c)["id"]
    mid = paste(c, h, qid).json()["message"]["id"]
    assert c.post(f"/api/quotes/{qid}/messages/{mid}/retry", headers=h).status_code == 409


def test_a_pasted_reply_dated_in_the_future_is_refused(ana):
    c, h = ana
    qid = new_quote(c)["id"]
    assert paste(c, h, qid, sent_at="2999-01-01T00:00:00Z").status_code == 422
    assert paste(c, h, qid, sent_at="2026-11-20T15:30:00Z").json()["message"]["sent_at"].startswith("2026-11-20T15:30")


@pytest.mark.parametrize("body", [{"direction": "out", "body": "x"}, {"direction": "out", "subject": "S", "body": ""}, {"direction": "in", "subject": "S", "body": "x"}])
def test_message_bodies_are_validated(ana, configured, body):
    c, h = ana
    qid = new_quote(c)["id"]
    assert c.post(f"/api/quotes/{qid}/messages", json=body, headers=h).status_code == 422


def test_photos_are_served_inline_with_nosniff_and_heic_as_a_download(ana, make_client, owner_engine):
    c, _ = ana
    a = start(c).json()
    p1 = photo(c, a["id"], a["token"]).json()["photo"]["id"]
    p2 = photo(c, a["id"], a["token"], HEIC).json()["photo"]["id"]
    submit(c, a["id"], a["token"])
    jpeg = c.get(f"/api/quotes/{a['id']}/photos/{p1}")
    assert jpeg.status_code == 200 and jpeg.content == JPEG and jpeg.headers["content-type"] == "image/jpeg"
    assert jpeg.headers["content-disposition"] == "inline" and jpeg.headers["x-content-type-options"] == "nosniff"
    heic = c.get(f"/api/quotes/{a['id']}/photos/{p2}")
    assert heic.headers["content-disposition"].startswith("attachment") and heic.headers["x-content-type-options"] == "nosniff"
    other = new_quote(c)["id"]
    assert c.get(f"/api/quotes/{other}/photos/{p1}").status_code == 404


def test_only_the_superadmin_deletes_and_the_task_survives(make_client, add_user, ana, owner_engine):
    c, h = ana
    a = start(c).json()
    photo(c, a["id"], a["token"])
    submit(c, a["id"], a["token"])
    paste(c, h, a["id"])
    assert c.delete(f"/api/quotes/{a['id']}", headers=h).status_code == 403
    root, rh = session(make_client, add_user, "boss", "superadmin")
    assert root.delete(f"/api/quotes/{a['id']}", headers=rh).status_code == 204
    assert sql(owner_engine, "SELECT (SELECT count(*) FROM quotes), (SELECT count(*) FROM quote_photos), (SELECT count(*) FROM quote_messages), (SELECT count(*) FROM tasks)")[0] == (0, 0, 0, 1)
    assert root.delete(f"/api/quotes/{a['id']}", headers=rh).status_code == 404


def test_audit_rows_hold_no_contact_details(ana, owner_engine, configured, outbox):
    c, h = ana
    qid = new_quote(c)["id"]
    reply(c, h, qid, body="Confidentiel 12345")
    paste(c, h, qid, body="Réponse privée")
    c.patch(f"/api/quotes/{qid}", json={"status": "won", "internal_note": "note secrète"}, headers=h)
    text = " ".join(f"{r[0]} {r[1]}" for r in sql(owner_engine, "SELECT action, details::text FROM audit_log WHERE action LIKE 'quote_%'"))
    for action in ("quote_reply_sent", "quote_reply_pasted", "quote_status_changed"):
        assert action in text
    for secret in ("maria", "418-555", "confidentiel", "privée", "secrète"):
        assert secret not in text.lower()


def test_the_internal_note_is_saved_and_limited(ana):
    c, h = ana
    qid = new_quote(c)["id"]
    assert c.patch(f"/api/quotes/{qid}", json={"internal_note": "Rappeler jeudi"}, headers=h).json()["quote"]["internal_note"] == "Rappeler jeudi"
    assert c.patch(f"/api/quotes/{qid}", json={"internal_note": "x" * 5001}, headers=h).status_code == 422
    assert c.patch(f"/api/quotes/{qid}", json={"status": "draft"}, headers=h).status_code == 422


@pytest.mark.parametrize("bad", [
    {"direction": "in", "body": "hello\u0000there"},
    {"direction": "out", "subject": "Hi\r\nBcc: x@y.zz", "body": "x"},
    {"direction": "out", "subject": "Hi\u0000", "body": "x"},
])
def test_control_characters_are_refused_in_messages(ana, configured, bad):
    c, h = ana
    qid = new_quote(c)["id"]
    assert c.post(f"/api/quotes/{qid}/messages", json=bad, headers=h).status_code == 422


def test_control_characters_are_refused_in_the_internal_note(ana):
    c, h = ana
    qid = new_quote(c)["id"]
    assert c.patch(f"/api/quotes/{qid}", json={"internal_note": "a\u0000b"}, headers=h).status_code == 422
    assert c.patch(f"/api/quotes/{qid}", json={"internal_note": "line one\nline two\ttab"}, headers=h).status_code == 200
