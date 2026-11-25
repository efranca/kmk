import hashlib

import pytest

from app.documents import uploads
from app.quotes import arrival, intake, limits
from helpers import ORIGIN, sql

JPEG = b"\xff\xd8\xff\xe0" + b"0" * 100
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 100
HEIC = b"\x00\x00\x00\x18ftypheic" + b"0" * 100


def qbody(**kw):
    base = dict(
        name="Maria Silva", email="Maria@Example.com", phone="418-555-0100", locale="fr-CA", kind="airbnb", city="Québec",
        property="apartment", bedrooms=2, bathrooms=1.5, frequency="weekly", address="123 rue Saint-Jean, app. 4",
    )
    base.update(kw)
    return base


def hdr(ip="203.0.113.7", **extra):
    return {**ORIGIN, "X-Real-Client-Ip": ip, **extra}


def start(c, ip="203.0.113.7", **kw):
    return c.post("/api/public/quotes", json=qbody(**kw), headers=hdr(ip))


def photo(c, qid, token, data=JPEG):
    return c.put(f"/api/public/quotes/{qid}/photos", content=data, headers={**ORIGIN, "X-Quote-Token": token})


def submit(c, qid, token):
    return c.post(f"/api/public/quotes/{qid}/submit", headers={**ORIGIN, "X-Quote-Token": token})


def draft_row(owner_engine, token="tok", hours_old=0, ip="9.9.9.9"):
    return sql(
        owner_engine,
        "INSERT INTO quotes (kind, name, email, phone, locale, ip, ip_key, token_hash, created_at) "
        "VALUES ('airbnb', 'N', 'n@example.com', '4185550100', 'fr-CA', :ip, :ip, :h, now() - make_interval(hours => :hrs)) RETURNING id",
        ip=ip, h=hashlib.sha256(token.encode()).hexdigest(), hrs=hours_old,
    )[0][0]


def test_draft_photo_submit_happy_path(client, owner_engine):
    r = client.post("/api/public/quotes", json=qbody(message="Beaucoup de détails"), headers=hdr() | {"User-Agent": "TestAgent/1", "X-Geo-Country": "CA", "X-Geo-City": "Quebec"})
    assert r.status_code == 201, r.text
    qid, token = r.json()["id"], r.json()["token"]
    assert photo(client, qid, token).status_code == 201
    assert photo(client, qid, token, PNG).json()["photo"]["content_type"] == "image/png"
    done = submit(client, qid, token)
    assert done.status_code == 200 and done.json() == {"reference": f"D-{qid:04d}"}
    row = sql(owner_engine, "SELECT status, email, ip, geo_country, geo_city, user_agent, locale, details->>'city', (details->>'bedrooms')::int, deadline_at - submitted_at, message FROM quotes")[0]
    assert tuple(row[:4]) == ("new", "maria@example.com", "203.0.113.7", "CA")
    assert row[4] == "Quebec" and row[5] == "TestAgent/1" and row[6] == "fr-CA" and row[7] == "Québec" and row[8] == 2
    assert row[9].total_seconds() == 24 * 3600 and row[10] == "Beaucoup de détails"
    assert sql(owner_engine, "SELECT count(*) FROM quote_photos")[0][0] == 2
    audit = sql(owner_engine, "SELECT ip, details::text FROM audit_log WHERE action = 'quote_received'")
    assert len(audit) == 1 and audit[0][0] == "203.0.113.7" and "maria" not in audit[0][1].lower()


def test_eleventh_request_in_an_hour_is_rate_limited(client):
    for _ in range(10):
        assert start(client).status_code == 201
    r = start(client)
    assert r.status_code == 429 and r.json() == {"error": "rate_limited"}
    assert start(client, ip="198.51.100.9").status_code == 201


def test_ipv6_counts_per_slash_64(client):
    for i in range(10):
        assert start(client, ip=f"2001:db8:1:2::{i + 1}").status_code == 201
    assert start(client, ip="2001:db8:1:2:ffff::1").status_code == 429
    assert start(client, ip="2001:db8:1:3::1").status_code == 201


def test_requests_older_than_an_hour_do_not_count(client, owner_engine):
    for _ in range(10):
        start(client)
    sql(owner_engine, "UPDATE quotes SET created_at = now() - interval '61 minutes'")
    assert start(client).status_code == 201


def test_message_word_and_char_limits(client):
    assert start(client, message="word " * 2000).status_code == 201
    too = start(client, message="word " * 2001)
    assert too.status_code == 422 and too.json() == {"error": "too_long"}
    assert start(client, message="é" * 20000).status_code == 201
    assert start(client, message="é" * 20001).json() == {"error": "too_long"}


def test_commercial_needs_a_message_and_airbnb_does_not(client):
    commercial = dict(kind="commercial", property="office", frequency="weekly", message=None)
    for key in ("bedrooms", "bathrooms"):
        commercial[key] = None
    assert start(client, **commercial).status_code == 422
    assert start(client, **{**commercial, "message": "Clinique de 3000 pi²"}).status_code == 201
    assert start(client, message=None).status_code == 201


def test_airbnb_fields_are_refused_on_commercial(client):
    r = start(client, kind="commercial", property="office", frequency="weekly", message="x", bedrooms=3)
    assert r.status_code == 422


@pytest.mark.parametrize(
    "bad",
    [dict(email="nope"), dict(phone="call me"), dict(name=""), dict(locale="en"), dict(kind="villa"), dict(frequency="daily"), dict(bedrooms=21), dict(city=""), dict(address=""), dict(city="x" * 61), dict(bedrooms=2.5), dict(area_sqft=0)],
)
def test_invalid_fields_are_refused(client, bad):
    assert start(client, **bad).status_code == 422


def test_honeypot_stores_nothing(client, owner_engine):
    r = start(client, website="http://spam.example")
    assert r.status_code == 201 and r.json()["id"] == 0
    assert submit(client, 0, r.json()["token"]).json() == {"reference": "D-0000"}
    assert sql(owner_engine, "SELECT count(*) FROM quotes")[0][0] == 0


def test_photo_rules(client, owner_engine):
    a = start(client).json()
    b = start(client).json()
    assert photo(client, a["id"], "wrong").status_code == 404
    assert photo(client, a["id"], b["token"]).status_code == 404
    r = photo(client, a["id"], a["token"], b"%PDF-1.4 not a photo")
    assert r.status_code == 422 and r.json() == {"error": "unsupported_type"}
    assert photo(client, a["id"], a["token"], HEIC).status_code == 201
    big = JPEG + b"0" * (limits.MAX_PHOTO_BYTES - len(JPEG) + 1)
    assert photo(client, a["id"], a["token"], big).json() == {"error": "file_too_large"}
    for _ in range(9):
        assert photo(client, a["id"], a["token"]).status_code == 201
    assert photo(client, a["id"], a["token"]).json() == {"error": "too_many_photos"}
    assert submit(client, a["id"], a["token"]).status_code == 200
    assert photo(client, a["id"], a["token"]).status_code == 404  # after submit
    old = draft_row(owner_engine, token="old", hours_old=3)
    assert photo(client, old, "old").status_code == 404


def test_pending_photo_storage_cap_answers_busy(client, monkeypatch):
    a = start(client).json()
    monkeypatch.setattr(limits, "MAX_PENDING_PHOTO_BYTES", 10)
    r = photo(client, a["id"], a["token"])
    assert r.status_code == 503 and r.json() == {"error": "busy"}


def test_submit_twice_is_idempotent(client, monkeypatch):
    calls = {"arrive": 0, "notify": 0}
    monkeypatch.setattr(arrival, "on_submitted", lambda db, quote: calls.__setitem__("arrive", calls["arrive"] + 1))
    monkeypatch.setattr(arrival, "notify", lambda engine, settings, quote_id: calls.__setitem__("notify", calls["notify"] + 1))
    a = start(client).json()
    first, second = submit(client, a["id"], a["token"]), submit(client, a["id"], a["token"])
    assert first.status_code == second.status_code == 200 and first.json() == second.json()
    assert calls == {"arrive": 1, "notify": 1}
    assert submit(client, a["id"], "wrong").status_code == 404


def test_expired_drafts_are_cleaned_when_the_next_request_starts(client, owner_engine):
    old = draft_row(owner_engine, hours_old=3)
    sql(owner_engine, "INSERT INTO quote_photos (quote_id, content_type, size, data) VALUES (:q, 'image/png', 3, 'abc')", q=old)
    fresh = draft_row(owner_engine, token="fresh", hours_old=1, ip="8.8.8.8")
    assert start(client).status_code == 201
    ids = [r[0] for r in sql(owner_engine, "SELECT id FROM quotes WHERE id IN (:a, :b)", a=old, b=fresh)]
    assert ids == [fresh]
    assert sql(owner_engine, "SELECT count(*) FROM quote_photos")[0][0] == 0


def test_config_returns_only_the_phone(client, owner_engine):
    sql(owner_engine, "INSERT INTO app_settings (key, value) VALUES ('public_phone', '(418) 555-0100'), ('quote_from', 'secret@example.com')")
    r = client.get("/api/public/quotes/config")
    assert r.status_code == 200 and r.json() == {"phone": "(418) 555-0100"}


# ---- review findings ---------------------------------------------------------------------------------------------

def test_the_street_address_never_reaches_tasks_events_the_notice_or_the_push(client, owner_engine, outbox, monkeypatch, add_user):
    add_user("ana", "ana@example.com", role="admin")
    sql(owner_engine, "INSERT INTO app_settings (key, value) VALUES ('quote_notify_email', 'team@gmail.com')")
    pushed = []
    monkeypatch.setattr(arrival.push, "send_to_admins", lambda engine, settings, payload: pushed.append(payload))
    a = start(client, address="123 rue Saint-Jean, app. 4, G1R 1N8").json()
    assert submit(client, a["id"], a["token"]).status_code == 200
    everywhere = " ".join(
        str(v) for row in sql(owner_engine, "SELECT tasks.title, tasks.description, events.title, events.notes FROM tasks, events") for v in row if v
    )
    everywhere += " ".join(f"{m.subject} {m.text} {m.html}" for m in outbox) + str(pushed)
    for secret in ("Saint-Jean", "G1R", "app. 4", "123"):
        assert secret not in everywhere
    assert "Québec" in everywhere  # the city is what they show
    assert sql(owner_engine, "SELECT details->>'address', details->>'city' FROM quotes")[0] == ("123 rue Saint-Jean, app. 4, G1R 1N8", "Québec")


def test_expired_drafts_do_not_count_toward_the_pending_photo_cap(client, owner_engine, monkeypatch):
    monkeypatch.setattr(limits, "MAX_PENDING_PHOTO_BYTES", 500)
    old = draft_row(owner_engine, token="old", hours_old=3)
    sql(owner_engine, "INSERT INTO quote_photos (quote_id, content_type, size, data) VALUES (:q, 'image/png', 400, 'abc')", q=old)
    a = start(client).json()
    assert photo(client, a["id"], a["token"]).status_code == 201  # 400 + 104 would be over 500 if the expired draft counted


def test_one_ip_cannot_store_more_photo_bytes_than_its_share_of_the_day(client, monkeypatch):
    monkeypatch.setattr(limits, "MAX_PHOTO_BYTES_PER_IP_DAY", 250)
    a = start(client).json()
    assert photo(client, a["id"], a["token"]).status_code == 201
    assert photo(client, a["id"], a["token"]).status_code == 201
    third = photo(client, a["id"], a["token"])
    assert third.status_code == 429 and third.json() == {"error": "rate_limited"}
    assert submit(client, a["id"], a["token"]).status_code == 200
    b = start(client).json()  # a sent request still counts against the same address
    assert photo(client, b["id"], b["token"]).status_code == 429
    c = start(client, ip="198.51.100.9").json()
    assert photo(client, c["id"], c["token"]).status_code == 201  # someone else is not affected


def test_public_photos_do_not_use_the_documents_upload_slots(client):
    a = start(client).json()
    uploads.slots.acquire()
    uploads.slots.acquire()
    try:
        assert photo(client, a["id"], a["token"]).status_code == 201
    finally:
        uploads.slots.release()
        uploads.slots.release()


def test_one_upload_at_a_time_per_draft(client):
    a = start(client).json()
    intake.uploading.add(a["id"])
    try:
        r = photo(client, a["id"], a["token"])
    finally:
        intake.uploading.discard(a["id"])
    assert r.status_code == 503 and r.json() == {"error": "busy"}
    assert photo(client, a["id"], a["token"]).status_code == 201  # and the slot is free again


def test_a_photo_that_never_finishes_arriving_times_out(client, monkeypatch):
    import asyncio

    async def stalled(request, limit=None, error="file_too_large"):
        await asyncio.sleep(5)

    monkeypatch.setattr(limits, "PHOTO_READ_SECONDS", 0.05)
    monkeypatch.setattr(uploads, "read_capped", stalled)
    a = start(client).json()
    r = photo(client, a["id"], a["token"])
    assert r.status_code == 408 and r.json() == {"error": "timeout"}
    assert intake.uploading == set()
    monkeypatch.undo()
    assert photo(client, a["id"], a["token"]).status_code == 201


@pytest.mark.parametrize("field", ["message", "name", "city", "address"])
def test_a_nul_character_is_refused_not_a_server_error(client, owner_engine, field):
    r = start(client, **{field: "hello\u0000there"}) if field != "message" else start(client, message="hello\u0000there")
    assert r.status_code == 422 and r.json() == {"error": "invalid"}
    assert sql(owner_engine, "SELECT count(*) FROM quotes")[0][0] == 0


def test_invisible_format_characters_pasted_from_maps_are_dropped_not_refused(client, owner_engine):
    assert start(client, name="Maria\u200e Silva", address="\u200e123 rue Saint-Jean").status_code == 201
    assert sql(owner_engine, "SELECT name, details->>'address' FROM quotes")[0] == ("Maria Silva", "123 rue Saint-Jean")


def test_the_engine_hides_statement_parameters_so_personal_data_cannot_reach_the_logs():
    from app.db import make_engine

    assert make_engine("postgresql+psycopg://u:p@localhost/x").hide_parameters is True
